import frappe
from frappe import _
from frappe.apf.user_scope import scope_conditions, scoped
from frappe.utils import getdate, nowdate
import calendar
from datetime import date
import json
import os
import re
import time
import gzip
import urllib.request
import urllib.error
import urllib.parse

# ---------------------------------------------------------------------------
# LGD boundary loader
# ---------------------------------------------------------------------------
#
# The browser previously fetched the full India-wide District (88 MB) and
# Block (284 MB) GeoJSONs from a stale `geohacker/india` mirror, then tried
# to filter them client-side. That had three failure modes:
#
#   1. Missing areas: the mirror predates 2017-2024 district splits and the
#      newer CD-block re-divisions, so freshly created districts/blocks (e.g.
#      Anakapalli, Bapatla, Sri Sathya Sai, Konaseema, Mewat -> Nuh, etc.)
#      simply had no polygon.
#   2. Duplicate boundaries: same-named districts in two states (Bilaspur in
#      Chhattisgarh + Himachal, Aurangabad in Maharashtra + Bihar, etc.)
#      both matched, so the wrong polygon coloured in.
#   3. Browser crashes / 30 s+ loads on slower networks.
#
# The fix: serve LGD-aligned GeoJSON (https://lgdirectory.gov.in/) sourced
# from bharatlas.com on the server, cache it, and only return the polygons
# that fall inside the selected scope.

_LEVEL_KEYS = {"2": "state", "3": "district", "4": "block"}

_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60   # 7 days - LGD changes are infrequent
_HTTP_TIMEOUT = 180

# Redis payload cap. Boundary collections routinely exceed the default Redis
# string budget; anything larger is served from the on-disk cache instead.
_REDIS_MAX_BYTES = 4 * 1024 * 1024

# ---------------------------------------------------------------------------
# Gram Panchayat boundary source
# ---------------------------------------------------------------------------
#
# GP boundaries come from the Ministry of Panchayati Raj's own ArcGIS
# service (mapservice.gov.in, "AdminGPHierarchy"), layer 3 = Gram Panchayat.
# These are the official surveyed GP polygons -- the same hierarchy LGD
# publishes -- and every feature carries its full parent chain as
# attributes:
#
#   GPNAME / GPCODE          the panchayat itself
#   blkname / blklgdcode     its parent Block   (LGD block code)
#   SDTNAME / sdtcode11      its parent Sub-District (tehsil/taluk)
#   DTNAME / DT_LGD          its parent District
#   STNAME / ST_LGD          its parent State
#
# Because the parent Block is an attribute, GPs can be scoped to the selected
# block with a server-side `where` clause instead of the centroid-in-polygon
# geometry test the Block level has to use against geoBoundaries ADM3 (which
# carries no parent field at all).
#
# This replaces the previous Voronoi approximation, which partitioned a block
# around its creche centroids and therefore drew cell edges that were
# equidistant lines between creches rather than real administrative limits.

_GP_SERVICE_URL = (
    "https://mapservice.gov.in/mapserviceserv176/rest/services"
    "/Panchayat/AdminGPHierarchy/MapServer/3/query"
)

# The service caps a single response at 1000 features, so blocks larger than
# that are paged through with resultOffset/resultRecordCount.
_GP_PAGE_SIZE = 1000
_GP_MAX_PAGES = 20

# Attribute names on the GP layer, kept in one place so a service-side
# rename only has to be fixed here.
#
# VILCODE11/VILNAME11 are the census-2011 village code/name carried on each
# GP-layer row: the service publishes no separate Village geometry layer, so
# a GP arrives as one row per constituent village area and these two columns
# are the only thing identifying which village each row is. They must be
# requested explicitly -- ArcGIS returns exactly the `outFields` asked for,
# so omitting them (as this list originally did) made every row look like it
# had no village at all, which is what pinned Total No. of Villages at 0.
# They are not always populated (a row can carry VILCODE11 = 0 and an empty
# VILNAME11), so callers must skip blanks rather than counting them.
_GP_FIELDS = "GPNAME,GPCODE,STNAME,DTNAME,SDTNAME,blkname,blklgdcode,VILCODE11,VILNAME11"


def _page_dir():
    return os.path.dirname(os.path.abspath(__file__))


def _cache_dir():
    """Site-private cache for downloaded LGD GeoJSONs."""
    try:
        base = frappe.get_site_path("private", "files", "geo_cache")
    except Exception:
        base = os.path.join(_page_dir(), ".geo_cache")
    os.makedirs(base, exist_ok=True)
    return base


def _norm(value):
    """Case- and punctuation-insensitive name comparator."""
    if value is None:
        return ""
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


# ADM3 shapeNames carry suffixes like " CD Block", " (Pt)", " Block" that
# don't appear in the Frappe Block doctype names.  Strip them before matching.
_ADM3_SUFFIX_RE = re.compile(
    r"\s*\bcd\s+block\b|\s*\bblock\b|\s*\(pt\.?\)|\s*\(part\)|\s*\btaluk\b|\s*\btehsil\b|\s*\bmandal\b|\s*\bsub\s*division\b|\s*\bcircle\b",
    re.IGNORECASE,
)


def _norm_adm3(shape_name):
    """Normalise an ADM3 shapeName by stripping common block suffixes first."""
    stripped = _ADM3_SUFFIX_RE.sub("", shape_name or "").strip()
    return _norm(stripped) or _norm(shape_name)


def _fuzzy_key(value):
    """Aggressive comparator that absorbs Indian transliteration variance.

    Collapses the spelling axes that actually differ between the ADM3
    shapeNames and the LGD-derived names stored in the Block doctype:
    aspirated consonants (singh/sing), -pore/-pur, doubled letters, and
    the interchangeable v/w and i/y.
    """
    key = _norm(value)
    if not key:
        return ""
    key = key.replace("ksh", "x").replace("ks", "x")
    key = key.replace("pore", "pur").replace("poor", "pur")
    key = key.replace("h", "")
    key = key.replace("w", "v").replace("y", "i")
    key = re.sub(r"(.)\1+", r"\1", key)
    return key


_VOWELS_RE = re.compile(r"[aeiou]")


def _consonant_key(value):
    """Consonant skeleton: the fuzzy key with all vowels removed.

    The remaining mismatches between the two sources are almost entirely
    inserted or dropped vowels -- Kalyansingpur/Kalyanasingpur,
    Semiliguda/Similiguda, Narayanpatna/Narayanpatana, Dasmantpur/Dasamantapur.
    Dropping vowels resolves those. This is deliberately only consulted after
    the district geometry has already narrowed the candidates to a single
    district, where a skeleton collision is very unlikely; applied India-wide it
    would be far too permissive.
    """
    skeleton = _VOWELS_RE.sub("", _fuzzy_key(value))
    return skeleton if len(skeleton) >= 4 else ""


# Reference data (not scoped, by design): the endpoints below return the same State / District /
# Block names, map geometry and layout config for everybody -- no creche, child, partner or
# staff data. They are login-only (no allow_guest). Everything that returns programme data is
# @scoped() and filtered with scope_conditions(); frappe/tests/test_endpoint_scope_coverage.py
# fails if a new endpoint is added without one of the two.
@frappe.whitelist()
def get_geolocation_config():
    """Read and return geolocation.json from the page directory."""
    return _load_config()


_CONFIG_CACHE = {"mtime": None, "data": None}


def _load_config():
    """Load geolocation.json, re-reading only when the file changes on disk."""
    json_path = os.path.join(_page_dir(), "geolocation.json")
    if not os.path.exists(json_path):
        return {}
    mtime = os.path.getmtime(json_path)
    if _CONFIG_CACHE["mtime"] == mtime and _CONFIG_CACHE["data"] is not None:
        return _CONFIG_CACHE["data"]
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    _CONFIG_CACHE["mtime"] = mtime
    _CONFIG_CACHE["data"] = data
    return data


# ---------------------------------------------------------------------------
# Active-scope helpers
# ---------------------------------------------------------------------------
#
# State and District both carry `is_active`. Block is not guaranteed to, so it
# is probed once per process and the filter is applied only when the column
# really exists -- that way switching a Block to is_active = 1 starts working
# the moment the field is added, with no code change here.

_HAS_COLUMN_CACHE = {}


def _has_column(doctype, column):
    """True if `column` exists on `tabDoctype`. Probed once, then cached."""
    key = (doctype, column)
    if key in _HAS_COLUMN_CACHE:
        return _HAS_COLUMN_CACHE[key]
    try:
        exists = column in frappe.db.get_table_columns(doctype)
    except Exception:
        exists = False
    _HAS_COLUMN_CACHE[key] = exists
    return exists


def _block_active_clause(alias="b"):
    """`AND b.is_active = 1` when Block actually has the column, else ''."""
    if _has_column("Block", "is_active"):
        return f" AND {alias}.is_active = 1"
    return ""


@frappe.whitelist()
def get_filter_meta():
    """Tell the client which optional columns exist, so it can build link
    queries that stay correct whether or not `Block.is_active` is present."""
    return {"block_has_is_active": _has_column("Block", "is_active")}


@frappe.whitelist()
def get_active_states():
    """Active States, for the State filter's link query."""
    return frappe.db.sql(
        """
        SELECT s.name AS value, s.state_name AS label
        FROM `tabState` AS s
        WHERE s.is_active = 1
        ORDER BY s.state_name ASC
        """,
        as_dict=True,
    )


@frappe.whitelist()
def get_active_districts(state=None):
    """Active Districts, optionally scoped to an active parent State."""
    params = {}
    where = ["d.is_active = 1", "s.is_active = 1"]
    if state:
        where.append("(d.state_id = %(state)s OR s.state_name = %(state)s)")
        params["state"] = state
    return frappe.db.sql(
        f"""
        SELECT d.name AS value, d.district_name AS label
        FROM `tabDistrict` AS d
        JOIN `tabState` AS s ON s.name = d.state_id
        WHERE {' AND '.join(where)}
        ORDER BY d.district_name ASC
        """,
        params,
        as_dict=True,
    )


@frappe.whitelist()
def get_active_blocks(district=None, state=None):
    """Active Blocks under active Districts/States, scoped to the selection."""
    params = {}
    where = ["d.is_active = 1", "s.is_active = 1"]
    if district:
        where.append("(b.district_id = %(district)s OR d.district_name = %(district)s)")
        params["district"] = district
    if state:
        where.append("(d.state_id = %(state)s OR s.state_name = %(state)s)")
        params["state"] = state
    return frappe.db.sql(
        f"""
        SELECT b.name AS value, b.block_name AS label
        FROM `tabBlock` AS b
        JOIN `tabDistrict` AS d ON d.name = b.district_id
        JOIN `tabState` AS s ON s.name = d.state_id
        WHERE {' AND '.join(where)}{_block_active_clause('b')}
        ORDER BY b.block_name ASC
        """,
        params,
        as_dict=True,
    )


def _get_district_names_for_state(state):
    """Names of the active districts recorded for the given state."""
    if not state:
        return set()
    rows = frappe.db.sql(
        """
        SELECT d.district_name
        FROM `tabDistrict` AS d
        JOIN `tabState` AS s ON s.name = d.state_id
        WHERE (s.state_name = %(state)s OR s.name = %(state)s)
          AND d.is_active = 1 AND s.is_active = 1
        """,
        {"state": state},
        as_dict=True,
    )
    return {r["district_name"] for r in rows if r.get("district_name")}


def _get_block_names_for_scope(*, district=None, state=None):
    """Normalised names of active blocks in the given district or state.

    Shared by _get_block_names_for_district/_get_block_names_for_state, which
    differ only in which column the scope value is matched against.
    """
    if district:
        clause, params = "(d.district_name = %(v)s OR d.name = %(v)s)", {"v": district}
    elif state:
        clause, params = "(s.state_name = %(v)s OR s.name = %(v)s)", {"v": state}
    else:
        return set()
    rows = frappe.db.sql(
        f"""
        SELECT b.block_name
        FROM `tabBlock` AS b
        JOIN `tabDistrict` AS d ON d.name = b.district_id
        JOIN `tabState` AS s ON s.name = d.state_id
        WHERE {clause}
          AND d.is_active = 1 AND s.is_active = 1{_block_active_clause('b')}
        """,
        params,
        as_dict=True,
    )
    return {_norm(r["block_name"]) for r in rows if r.get("block_name")}


def _get_block_names_for_district(district):
    """Normalised names of active blocks in the given district."""
    return _get_block_names_for_scope(district=district)


def _get_block_names_for_state(state):
    """Normalised names of active blocks in the given state."""
    return _get_block_names_for_scope(state=state)


def _resolve_scope_names(state=None, district=None):
    """Map a State/District filter value (docname *or* label) to its real name.

    The client sends the link field's docname; the ADM3 properties carry human
    names. Resolving here keeps the name matching below source-agnostic.
    """
    state_name, district_name = state or "", district or ""
    if district:
        row = frappe.db.sql(
            """
            SELECT d.district_name, s.state_name
            FROM `tabDistrict` AS d
            JOIN `tabState` AS s ON s.name = d.state_id
            WHERE d.name = %(d)s OR d.district_name = %(d)s
            LIMIT 1
            """,
            {"d": district},
            as_dict=True,
        )
        if row:
            district_name = row[0].get("district_name") or district_name
            state_name = row[0].get("state_name") or state_name
    elif state:
        row = frappe.db.sql(
            "SELECT state_name FROM `tabState` WHERE name = %(s)s OR state_name = %(s)s LIMIT 1",
            {"s": state},
            as_dict=True,
        )
        if row:
            state_name = row[0].get("state_name") or state_name
    return state_name, district_name


def _first_present(props, keys):
    """Return the first value found in `props` for any key in `keys`."""
    if not props:
        return ""
    for k in keys or []:
        if k in props and props[k] not in (None, ""):
            return props[k]
    # Case-insensitive fallback - LGD layers are lowercase but other mirrors
    # use upper/mixed case property keys.
    lowered = {str(k).lower(): k for k in props.keys()}
    for k in keys or []:
        actual = lowered.get(str(k).lower())
        if actual and props[actual] not in (None, ""):
            return props[actual]
    return ""


def _expand_aliases(value, alias_map):
    """Return the canonical name + all alias forms, lowercased+stripped."""
    out = set()
    if not value:
        return out
    out.add(_norm(value))
    if not alias_map:
        return out
    for canonical, aliases in alias_map.items():
        c_norm = _norm(canonical)
        a_norms = {_norm(a) for a in (aliases or [])}
        # if the supplied value matches the canonical, add all aliases
        if _norm(value) == c_norm:
            out.update(a_norms)
        # if it matches an alias, add the canonical and the other aliases
        if _norm(value) in a_norms:
            out.add(c_norm)
            out.update(a_norms)
    return out


def _download_layer(url, cache_path):
    """Download a GeoJSON layer, transparently handling gzip and caching."""
    if os.path.exists(cache_path):
        age = time.time() - os.path.getmtime(cache_path)
        if age < _CACHE_TTL_SECONDS and os.path.getsize(cache_path) > 1024:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Frappe-APF-Saturation-Dashboard/1.0 (+boundary fetch)",
            "Accept": "application/geo+json, application/json;q=0.9, */*;q=0.1",
            "Accept-Encoding": "gzip",
        },
    )
    with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding", "").lower() == "gzip" or raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
    data = json.loads(raw.decode("utf-8"))
    tmp = cache_path + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, cache_path)
    return data


def _empty_collection():
    return {"type": "FeatureCollection", "features": []}


_ADM3_LOCAL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "geoBoundaries-IND-ADM3.geojson")
_ADM3_REMOTE_URL = "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM3/geoBoundaries-IND-ADM3.geojson"


def _load_adm3():
    """Load the ADM3 geojson from local file; fall back to remote download + cache."""
    if os.path.exists(_ADM3_LOCAL_PATH) and os.path.getsize(_ADM3_LOCAL_PATH) > 1024 * 1024:
        with open(_ADM3_LOCAL_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    cache_path = os.path.join(_cache_dir(), "geoBoundaries-IND-ADM3.geojson")
    return _download_layer(_ADM3_REMOTE_URL, cache_path)


# ---------------------------------------------------------------------------
# Per-scope disk cache
# ---------------------------------------------------------------------------
#
# The ADM3 source is ~284 MB and is only fully parsed to produce a small
# per-district slice. That slice is written to disk so the expensive parse
# happens once per district for the life of the deployment, rather than
# once per Redis eviction.

def _scope_cache_path(level, state, district):
    # Bump the version whenever the emitted feature/property shape changes, so
    # entries written by an older build are never served.
    return os.path.join(_cache_dir(), f"scope_v6_{level}_{_norm(state)}_{_norm(district)}.geojson")


def _read_scope_cache(path):
    try:
        if os.path.exists(path) and os.path.getsize(path) > 2:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return None


def _write_scope_cache(path, payload):
    try:
        tmp = path + ".part"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        pass


def _cache_get(mem_cache, key):
    if not mem_cache:
        return None
    try:
        cached = mem_cache.get_value(key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass
    return None


def _cache_set(mem_cache, key, payload):
    """Store in Redis only when the payload is small enough to be worth it."""
    if not mem_cache:
        return
    try:
        blob = json.dumps(payload)
        if len(blob) <= _REDIS_MAX_BYTES:
            mem_cache.set_value(key, blob, expires_in_sec=3600)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Block-level geometry scoping
# ---------------------------------------------------------------------------
#
# geoBoundaries ADM3 carries no parent-district field -- the only usable
# property is `shapeName` (shapeGroup is the ISO country code, "IND"). Matching
# blocks by name alone therefore pulls in identically-named blocks anywhere in
# India: "Khairaput" in Malkangiri matched "Khaira" in Bihar, "Khaira" in north
# Odisha and "Khair" in Uttar Pradesh, ~1200 km apart, which blew up fitBounds
# and left the district as a few unreadable slivers.
#
# The reliable discriminator is geography: take the selected district's polygon
# from the district layer and keep only those ADM3 blocks whose centroid falls
# inside it.


def _geom_rings(geometry):
    """Outer rings of a Polygon/MultiPolygon, as coordinate lists."""
    if not geometry:
        return []
    gtype = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if gtype == "Polygon":
        return [coords[0]] if coords else []
    if gtype == "MultiPolygon":
        return [poly[0] for poly in coords if poly]
    return []


def _geom_polygons(geometry):
    """Normalise a Polygon/MultiPolygon into a list of polygon coordinate
    arrays (each an outer ring followed by any holes).

    Lets Polygon and MultiPolygon parts of the same feature set be merged
    into one MultiPolygon without special-casing either at the call site.
    """
    if not geometry:
        return []
    gtype = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if gtype == "Polygon":
        return [coords] if coords else []
    if gtype == "MultiPolygon":
        return [poly for poly in coords if poly]
    return []


def _geom_centroid(geometry):
    """Average vertex position. Adequate here: it is only used to ask which
    district a block sits in, not for cartographic placement."""
    if not geometry:
        return None
    coords = geometry.get("coordinates")
    depth = {"Polygon": 2, "MultiPolygon": 3}.get(geometry.get("type"))
    if not coords or depth is None:
        return None

    xs, ys, count = 0.0, 0.0, 0

    def walk(node, level):
        nonlocal xs, ys, count
        if level == 0:
            if len(node) >= 2:
                xs += node[0]
                ys += node[1]
                count += 1
            return
        for child in node:
            walk(child, level - 1)

    walk(coords, depth)
    if not count:
        return None
    return (xs / count, ys / count)


def _point_in_ring(point, ring):
    """Standard ray-casting test."""
    x, y = point
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y):
            denom = (yj - yi) or 1e-12
            if x < (xj - xi) * (y - yi) / denom + xi:
                inside = not inside
        j = i
    return inside


def _bbox_of_rings(rings):
    xs, ys = [], []
    for ring in rings:
        for p in ring:
            xs.append(p[0])
            ys.append(p[1])
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def _get_district_rings(state_name, district_name):
    """Outer rings of the selected district, from the district boundary layer.

    Reuses the same cached download the District level already uses, so this
    adds no new network cost.
    """
    if not district_name:
        return []

    config = _load_config()
    sources = config.get("boundary_sources") or {}
    aliases = config.get("name_aliases") or {}
    fields = (config.get("boundary_fields") or {}).get("district", {}) or {}
    url = sources.get("district") or ""
    if not url:
        return []

    cache_path = os.path.join(_cache_dir(), "lgd_level_3.geojson")
    try:
        data = _download_layer(url, cache_path)
    except Exception as e:
        frappe.log_error(title="District layer unavailable for block scoping", message=str(e))
        return []

    name_keys = fields.get("name") or ["NAME_2", "district", "dtname"]
    parent_keys = fields.get("parent_state_name") or ["NAME_1", "ST_NM", "state", "stname"]
    district_aliases = aliases.get("district") or {}
    state_alias_set = _expand_aliases(state_name, aliases.get("state") or {})
    target = _expand_aliases(district_name, district_aliases)

    rings = []
    for feat in data.get("features") or []:
        props = feat.get("properties") or {}
        if not (_expand_aliases(_first_present(props, name_keys), district_aliases) & target):
            continue
        # Same-named districts exist in several states, so confirm the parent
        # state too whenever we know it.
        if state_alias_set:
            feat_state = _first_present(props, parent_keys)
            if feat_state and _norm(feat_state) not in state_alias_set:
                continue
        rings.extend(_geom_rings(feat.get("geometry")))
    return rings


# ---------------------------------------------------------------------------
# Gram Panchayat boundaries (official MoPR service)
# ---------------------------------------------------------------------------


def _gp_query(where, offset=0):
    """One page of GP features from the MoPR service, as GeoJSON.

    `outSR=4326` is requested explicitly: the service's native spatial
    reference is Web Mercator, and Leaflet needs lon/lat degrees.
    """
    params = urllib.parse.urlencode({
        "where": where,
        "outFields": _GP_FIELDS,
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
        "resultOffset": str(offset),
        "resultRecordCount": str(_GP_PAGE_SIZE),
    })
    req = urllib.request.Request(
        "{0}?{1}".format(_GP_SERVICE_URL, params),
        headers={
            "User-Agent": "Frappe-APF-Saturation-Dashboard/1.0 (+GP boundary fetch)",
            "Accept": "application/geo+json, application/json;q=0.9, */*;q=0.1",
            "Accept-Encoding": "gzip",
        },
    )
    with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding", "").lower() == "gzip" or raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def _gp_fetch_all(where):
    """Every GP feature matching `where`, paging past the 1000-row cap."""
    features = []
    for page in range(_GP_MAX_PAGES):
        data = _gp_query(where, offset=page * _GP_PAGE_SIZE)
        batch = data.get("features") or []
        features.extend(batch)
        # The service reports more-available via exceededTransferLimit; a
        # short page also means we are done. Checking both means a service
        # that omits the flag still terminates.
        exceeded = data.get("exceededTransferLimit")
        if exceeded is None:
            exceeded = (data.get("properties") or {}).get("exceededTransferLimit")
        if not batch:
            break
        if not exceeded and len(batch) < _GP_PAGE_SIZE:
            break
    return features


def _sql_quote(value):
    """Single-quote escaping for an ArcGIS `where` string literal."""
    return str(value or "").replace("'", "''")


def _gp_where_for_district(state_name, district_name):
    """`where` clause selecting every GP in one district.

    The district is the smallest unit worth fetching and caching: it is one
    request that then serves every block inside it, and block spellings vary
    far more between the service and LGD than district spellings do, so the
    block itself is matched locally against the fetched attributes.
    """
    clauses = []
    if district_name:
        clauses.append("UPPER(DTNAME) LIKE '%{0}%'".format(_sql_quote(district_name).upper()))
    if state_name:
        clauses.append("UPPER(STNAME) LIKE '%{0}%'".format(_sql_quote(state_name).upper()))
    return " AND ".join(clauses) if clauses else "1=1"


_GP_BLOCK_SERIAL_RE = re.compile(r"-\s*\d+\s*$")


def _gp_where_for_block(state_name, block_name):
    """`where` clause selecting GPs by parent block rather than district.

    Only used when the district could not be resolved -- see the fallback in
    get_gp_boundary_geojson. Matches either of the two parent-block fields,
    since which one carries the usable spelling varies by state.
    """
    base = _GP_BLOCK_SERIAL_RE.sub("", str(block_name or "")).strip()
    safe = _sql_quote(base).upper()
    clauses = ["(UPPER(blkname) LIKE '%{0}%' OR UPPER(SDTNAME) LIKE '%{0}%')".format(safe)]
    if state_name:
        clauses.append("UPPER(STNAME) LIKE '%{0}%'".format(_sql_quote(state_name).upper()))
    return " AND ".join(clauses)


def _gp_block_matches(props, block_name):
    """Does this GP feature belong to the requested block?

    The service records a GP's parent block twice and the two disagree often
    enough that both have to be consulted:

      blkname   the Community Development block, frequently carrying an LGD
                serial suffix ("TARN TARAN-12") or a different transliteration
      SDTNAME   the sub-district / tehsil, which in most states is the name
                the Block doctype actually stores

    In Jashpur district, for instance, GPs with blkname "BAGICHA" are split
    across the "Bagicha" and "Kansabel" sub-districts, so matching on only one
    field either over- or under-selects. A hit on either field, through the
    same escalating comparators the Block level uses, counts as a match.
    """
    target = _norm(block_name)
    if not target:
        return False
    target_fuzzy = _fuzzy_key(block_name)
    target_cons = _consonant_key(block_name)

    for key in ("blkname", "SDTNAME"):
        raw = props.get(key) or ""
        if not raw:
            continue
        # LGD block names often end in a "-<serial>" disambiguator that the
        # Block doctype does not carry; drop it before comparing.
        base = _GP_BLOCK_SERIAL_RE.sub("", str(raw)).strip()
        cand = _norm_adm3(base)
        if not cand:
            continue
        if cand == target:
            return True
        if target_fuzzy and _fuzzy_key(base) == target_fuzzy:
            return True
        if target_cons and _consonant_key(base) == target_cons:
            return True
        # Containment, last: only for names long enough that a shared prefix
        # is meaningful rather than coincidental.
        if len(cand) > 4 and len(target) > 4 and (cand in target or target in cand):
            return True
    return False


def _gp_scope_cache_path(state, district):
    # Bump the version whenever the emitted feature/property shape changes.
    # v2: _GP_FIELDS gained VILCODE11/VILNAME11. Every v1 file on disk was
    # written without those columns and would otherwise keep being served for
    # up to _CACHE_TTL_SECONDS, so village counts would stay 0 even with the
    # field list fixed.
    return os.path.join(_cache_dir(), "gp_v2_{0}_{1}.geojson".format(_norm(state), _norm(district)))


def _load_district_gps(state_name, district_name):
    """All GP features for a district, memoised on disk for _CACHE_TTL_SECONDS.

    Cached per district rather than per block: one district is a single
    request (a few hundred KB) and every block inside it is then served
    without touching the network again.
    """
    path = _gp_scope_cache_path(state_name, district_name)
    if os.path.exists(path):
        age = time.time() - os.path.getmtime(path)
        if age < _CACHE_TTL_SECONDS and os.path.getsize(path) > 2:
            cached = _read_scope_cache(path)
            if cached is not None:
                return cached.get("features") or []

    features = _gp_fetch_all(_gp_where_for_district(state_name, district_name))
    _write_scope_cache(path, {"type": "FeatureCollection", "features": features})
    return features


def _collect_block_gps(district_features, block_name):
    """GP features belonging to one block, as a FeatureCollection.

    A single Gram Panchayat is published as one row per constituent village
    area, so a GP is routinely several separate Polygon rows sharing one
    GPCODE -- Jashpur block returns 145 rows for its 46 panchayats. Keeping
    only the first row of each would drop real territory and leave holes in
    the map, so the parts are merged into one MultiPolygon feature per GP:
    one polygon, one label, one popup, complete area.
    """
    merged = {}
    order = []
    for feat in district_features or []:
        props = feat.get("properties") or {}
        if not _gp_block_matches(props, block_name):
            continue
        gp_name = (props.get("GPNAME") or "").strip()
        if not gp_name:
            continue

        # GPCODE is blank on a large share of rows, so the normalised name is
        # the fallback identity -- within one block it is unambiguous.
        key = props.get("GPCODE") or _norm(gp_name)
        entry = merged.get(key)
        if entry is None:
            out_props = dict(props)
            out_props["_gpName"] = gp_name
            out_props["_gpKey"] = _norm(gp_name)
            entry = merged[key] = {"props": out_props, "polygons": []}
            order.append(key)
        entry["polygons"].extend(_geom_polygons(feat.get("geometry")))

    features = []
    for key in order:
        entry = merged[key]
        polygons = entry["polygons"]
        if not polygons:
            continue
        entry["props"]["_parts"] = len(polygons)
        features.append({
            "type": "Feature",
            "properties": entry["props"],
            "geometry": (
                {"type": "Polygon", "coordinates": polygons[0]}
                if len(polygons) == 1
                else {"type": "MultiPolygon", "coordinates": polygons}
            ),
        })

    return {"type": "FeatureCollection", "features": features}


def _match_block_row(block, district=None, state=None):
    """Locate a Block record whose name only *normalises* to `block`.

    Fallback for callers that pass a boundary-layer name rather than a Block
    docname -- the ADM3 shapeName carries suffixes ("CD Block", "(Pt)") and
    transliteration variance the Block doctype does not. Candidates are
    narrowed by district/state first when those are known, so a normalised
    collision cannot pull in a same-named block from elsewhere.

    Returns a one-row list shaped like the exact-match query, or [].
    """
    if not block:
        return []

    where = ["d.is_active = 1", "s.is_active = 1"]
    params = {}
    if district:
        where.append("(b.district_id = %(district)s OR d.district_name = %(district)s)")
        params["district"] = district
    if state:
        where.append("(d.state_id = %(state)s OR s.state_name = %(state)s)")
        params["state"] = state

    try:
        rows = frappe.db.sql(
            """
            SELECT b.block_name, d.district_name, s.state_name
            FROM `tabBlock` AS b
            JOIN `tabDistrict` AS d ON d.name = b.district_id
            JOIN `tabState` AS s ON s.name = d.state_id
            WHERE {0}
            """.format(" AND ".join(where)),
            params,
            as_dict=True,
        )
    except Exception:
        return []

    target = _norm_adm3(block)
    if not target:
        return []

    # Exact normalised match, then the same transliteration-tolerant and
    # consonant-skeleton tiers the Block level uses.
    for row in rows:
        if _norm_adm3(row.get("block_name") or "") == target:
            return [row]

    target_fuzzy = _fuzzy_key(block)
    if target_fuzzy:
        for row in rows:
            if _fuzzy_key(row.get("block_name") or "") == target_fuzzy:
                return [row]

    target_cons = _consonant_key(block)
    if target_cons:
        matches = [r for r in rows if _consonant_key(r.get("block_name") or "") == target_cons]
        # Ambiguous skeletons are dropped rather than guessed.
        if len(matches) == 1:
            return matches

    return []


@frappe.whitelist()
def get_gp_boundary_geojson(state=None, district=None, block=None):
    """Official Gram Panchayat polygons inside the selected Block.

    Mirrors get_boundary_geojson's contract one level down: the client asks
    for a scope and gets back a FeatureCollection whose features carry a
    normalised `_gpName` (plus the LGD codes) to join against creche data.

    Scoping is attribute-based, not geometric -- every GP feature names its
    parent block, district and state -- so unlike the Block level there is no
    centroid-in-polygon test and no chance of pulling in an identically-named
    panchayat from another district.
    """
    state_name, district_name = _resolve_scope_names(state, district)

    # A block resolved from a docname needs its human name for matching, and
    # its district/state fill in whatever the caller left blank.
    #
    # The caller is not always passing a Block docname: isolateBlock sends the
    # *boundary layer's* name, which is an ADM3 shapeName and routinely
    # differs from block_name by a suffix ("Bagicha CD Block") or by
    # transliteration. An exact-match-only lookup missed those, left
    # district_name empty and returned nothing -- a blank GP layer. So the
    # exact match is tried first and a normalised comparison backs it up.
    block_name = block or ""
    if block:
        row = frappe.db.sql(
            """
            SELECT b.block_name, d.district_name, s.state_name
            FROM `tabBlock` AS b
            JOIN `tabDistrict` AS d ON d.name = b.district_id
            JOIN `tabState` AS s ON s.name = d.state_id
            WHERE b.name = %(b)s OR b.block_name = %(b)s
            LIMIT 1
            """,
            {"b": block},
            as_dict=True,
        )
        if not row:
            row = _match_block_row(block, district, state)
        if row:
            block_name = row[0].get("block_name") or block_name
            district_name = district_name or row[0].get("district_name") or ""
            state_name = state_name or row[0].get("state_name") or ""

    # The district is what scopes the upstream query, so it is the one field
    # that cannot be guessed. The block name, by contrast, is matched locally
    # against the fetched attributes and tolerates spelling drift there.
    if not district_name or not block_name:
        return _empty_collection()

    cache_key = "gpboundary:v1:{0}:{1}:{2}".format(
        _norm(state_name), _norm(district_name), _norm(block_name)
    )
    mem_cache = None
    try:
        mem_cache = frappe.cache()
    except Exception:
        pass

    cached = _cache_get(mem_cache, cache_key)
    if cached:
        return cached

    try:
        district_features = _load_district_gps(state_name, district_name)
    except Exception as e:
        frappe.log_error(
            title="GP boundary fetch failed",
            message="state={0} district={1} block={2}\n{3}".format(
                state_name, district_name, block_name, e
            ),
        )
        return _empty_collection()

    # An unresolved district (a docname that no District record matched, so
    # `district_name` is still something like "DIST-00123") queries the
    # upstream service for a name it has never heard of and comes back empty,
    # which reaches the client as a silently blank GP layer. Retrying on the
    # block name alone recovers it: `blkname`/`SDTNAME` are indexed the same
    # way, and the per-feature block match below still confines the result to
    # the requested block.
    if not district_features and block_name:
        try:
            district_features = _gp_fetch_all(
                _gp_where_for_block(state_name, block_name)
            )
        except Exception as e:
            frappe.log_error(
                title="GP boundary block-name fallback failed",
                message="state={0} block={1}\n{2}".format(state_name, block_name, e),
            )
            district_features = []

    out_features = _collect_block_gps(district_features, block_name)["features"]

    out = {
        "type": "FeatureCollection",
        "features": out_features,
        "_meta": {
            "level": "6",
            "scope_state": state_name,
            "scope_district": district_name,
            "scope_block": block_name,
            "count": len(out_features),
            # How many GPs the district holds in total -- if `count` is 0 but
            # this is not, the block name failed to match and that is the
            # first thing to check.
            "district_count": len(district_features),
            "source": _GP_SERVICE_URL,
        },
    }
    _cache_set(mem_cache, cache_key, out)
    return out


@frappe.whitelist()
def get_district_gp_boundaries(state=None, district=None, blocks=None):
    """Every Gram Panchayat polygon in a district, grouped by parent block.

    The block-level map draws all of a district's blocks at once, so asking
    for each block separately would fire N parallel requests that each miss
    the cache and each trigger the same district-wide upstream fetch (~14 s
    for the first, on a cold cache). This serves all of them from one fetch.

    `blocks` is an optional JSON list of Block names to restrict the result
    to -- normally the blocks actually on screen. Omit it for the whole
    district.

    Returns {"blocks": {<block name>: <FeatureCollection>}, "_meta": {...}},
    keyed by the block name the caller asked for, so the client can look up
    each block's collection by the same name its map layer carries.
    """
    state_name, district_name = _resolve_scope_names(state, district)
    if not district_name:
        return {"blocks": {}, "_meta": {"error": "unresolved district", "scope_district": district}}

    requested = []
    if blocks:
        if isinstance(blocks, str):
            try:
                requested = json.loads(blocks)
            except ValueError:
                requested = [b.strip() for b in blocks.split(",") if b.strip()]
        elif isinstance(blocks, (list, tuple)):
            requested = list(blocks)
    requested = [b for b in requested if b]

    try:
        district_features = _load_district_gps(state_name, district_name)
    except Exception as e:
        frappe.log_error(
            title="District GP boundary fetch failed",
            message="state={0} district={1}\n{2}".format(state_name, district_name, e),
        )
        return {"blocks": {}, "_meta": {"error": "fetch failed", "scope_district": district_name}}

    # Without an explicit list, every distinct parent block in the district is
    # emitted under its own name from the service.
    if not requested:
        seen = []
        for feat in district_features:
            name = ((feat.get("properties") or {}).get("blkname") or "").strip()
            if name and name not in seen:
                seen.append(name)
        requested = seen

    out_blocks = {}
    for block_name in requested:
        collection = _collect_block_gps(district_features, block_name)
        out_blocks[block_name] = collection

    return {
        "blocks": out_blocks,
        "_meta": {
            "scope_state": state_name,
            "scope_district": district_name,
            "district_count": len(district_features),
            "blocks_requested": len(requested),
            "blocks_matched": sum(1 for c in out_blocks.values() if c["features"]),
            "source": _GP_SERVICE_URL,
        },
    }


@frappe.whitelist()
def get_boundary_geojson(level=None, state=None, district=None):
    """Return GeoJSON boundaries scoped to the selected level.

    level "2" = State  (external URL from geolocation.json)
    level "3" = District (external URL from geolocation.json)
    level "4" = Block  (local geoBoundaries-IND-ADM3.geojson, shapeName property)

    For level 4 every polygon that belongs to the selected district is
    returned, whether or not its name matches a Block record. Matching is
    reported per-feature via the `_matched` property so the client can colour
    known blocks and still draw the rest -- that is what keeps the district
    outline geographically complete instead of full of holes.
    """
    level = str(level) if level is not None else ""
    if level not in _LEVEL_KEYS:
        return _empty_collection()

    cache_key = f"boundary:v6:{level}:{_norm(state)}:{_norm(district)}"
    mem_cache = None
    try:
        mem_cache = frappe.cache()
    except Exception:
        pass

    cached = _cache_get(mem_cache, cache_key)
    if cached:
        return cached

    # ---- Block level: use local ADM3 file filtered via Frappe DB -----------
    if level == "4":
        scope_path = _scope_cache_path(level, state, district)
        on_disk = _read_scope_cache(scope_path)
        if on_disk:
            _cache_set(mem_cache, cache_key, on_disk)
            return on_disk

        try:
            adm3 = _load_adm3()
        except Exception as e:
            frappe.log_error(title="ADM3 load failed", message=str(e))
            return _empty_collection()

        features = adm3.get("features") or []

        state_name, district_name = _resolve_scope_names(state, district)

        if district:
            allowed = _get_block_names_for_district(district)
        elif state:
            allowed = _get_block_names_for_state(state)
        else:
            allowed = set()

        # Two indexes over the DB block names, so an ADM3 spelling that differs
        # only by suffix/transliteration still resolves to its Block record.
        # The consonant index is the looser of the two and is only consulted
        # once geography has confined the candidates to one district.
        fuzzy_allowed = {}
        consonant_allowed = {}
        for norm_name in allowed:
            fuzzy_allowed.setdefault(_fuzzy_key(norm_name), norm_name)
            ckey = _consonant_key(norm_name)
            if ckey:
                # A skeleton shared by two blocks in the same district is
                # ambiguous, so it is withdrawn rather than guessed.
                consonant_allowed[ckey] = None if ckey in consonant_allowed else norm_name

        # Geographic scope for the selected district. This is the primary
        # filter: ADM3 has no parent field, so names alone cannot tell a block
        # in this district from an identically-named one across the country.
        district_rings = _get_district_rings(state_name, district_name)
        district_bbox = _bbox_of_rings(district_rings)

        def inside_district(geometry):
            if not district_rings:
                return False
            centroid = _geom_centroid(geometry)
            if not centroid:
                return False
            if district_bbox:
                # Cheap reject before the ray-casting test; ADM3 is ~6.8k
                # features and most are nowhere near the selected district.
                minx, miny, maxx, maxy = district_bbox
                if not (minx <= centroid[0] <= maxx and miny <= centroid[1] <= maxy):
                    return False
            return any(_point_in_ring(centroid, ring) for ring in district_rings)

        filtered = []
        for feat in features:
            props = feat.get("properties") or {}
            shape_name = props.get("shapeName") or ""
            if not shape_name:
                continue

            in_district = inside_district(feat.get("geometry"))

            # Without district geometry there is nothing to scope against, so
            # fall back to name matching alone rather than returning nothing.
            if district_rings and not in_district:
                continue

            adm3_norm = _norm_adm3(shape_name)

            # 1. exact match after suffix stripping
            if adm3_norm in allowed:
                matched = adm3_norm
            else:
                # 2. transliteration-tolerant match
                matched = fuzzy_allowed.get(_fuzzy_key(adm3_norm))

                # Tiers 3 and 4 are only safe once geography has already
                # confined us to this district -- applied India-wide, tier 4
                # matched "Khaira" (Bihar) and "Khair" (UP) to Malkangiri's
                # "Khairaput", ~1200 km away.
                # 3. consonant skeleton, for inserted/dropped vowels
                if not matched and in_district:
                    ckey = _consonant_key(adm3_norm)
                    if ckey:
                        matched = consonant_allowed.get(ckey)

                # 4. containment
                if not matched and in_district and len(adm3_norm) > 4:
                    for cand in allowed:
                        if len(cand) > 4 and (cand in adm3_norm or adm3_norm in cand):
                            matched = cand
                            break

            if not matched and not in_district:
                continue

            out_feat = dict(feat)
            out_props = dict(props)
            out_props["_matched"] = bool(matched)
            out_props["_blockKey"] = matched or ""
            out_feat["properties"] = out_props
            filtered.append(out_feat)

        out = {
            "type": "FeatureCollection",
            "features": filtered,
            "_meta": {
                "level": level,
                "scope_state": state_name,
                "scope_district": district_name,
                "count": len(filtered),
                "matched": sum(1 for f in filtered if f["properties"].get("_matched")),
                # 0 means the district polygon could not be resolved and the
                # result fell back to name-only matching -- the first thing to
                # check if a block map looks wrong.
                "district_rings": len(district_rings),
            },
        }
        _write_scope_cache(scope_path, out)
        _cache_set(mem_cache, cache_key, out)
        return out

    # ---- State / District level: download from external URL ----------------
    config = _load_config()
    sources = config.get("boundary_sources") or {}
    aliases = config.get("name_aliases") or {}
    fields = (config.get("boundary_fields") or {}).get(_LEVEL_KEYS[level], {}) or {}

    url = sources.get(_LEVEL_KEYS[level]) or ""
    if not url:
        return _empty_collection()

    cache_path = os.path.join(_cache_dir(), f"lgd_level_{level}.geojson")
    try:
        data = _download_layer(url, cache_path)
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as e:
        frappe.log_error(title="Boundary GeoJSON fetch failed", message=f"level={level} url={url}\n{e}")
        return _empty_collection()

    features = data.get("features") or []

    if level == "2":
        out = {"type": "FeatureCollection", "features": features, "_meta": {"source": url, "count": len(features), "level": level}}
        _cache_set(mem_cache, cache_key, out)
        return out

    # ---- District level -----------------------------------------------------
    #
    # The district layer is a pre-2014 GADM snapshot, so its state names lag the
    # current ones ("Orissa", "Uttaranchal") and Telangana is still filed under
    # Andhra Pradesh. Two passes handle that:
    #
    #   1. parent-state match, alias-aware, to pick the candidate districts;
    #   2. cross-check each candidate against the districts actually recorded
    #      for this state in Frappe, which re-splits the states that the
    #      snapshot still merges and drops any district that isn't really ours.
    #
    # Pass 2 is skipped when the state has no districts on record, so a state
    # that hasn't been populated yet still renders its full boundary set.
    state_name, _ = _resolve_scope_names(state, None)
    state_alias_set = _expand_aliases(state_name or state, aliases.get("state") or {})
    parent_state_keys = fields.get("parent_state_name") or ["NAME_1", "ST_NM", "state", "stname"]
    name_keys = fields.get("name") or ["NAME_2", "district", "dtname"]

    candidates = []
    for feat in features:
        props = feat.get("properties") or {}
        if state_alias_set and parent_state_keys:
            feat_state = _first_present(props, parent_state_keys)
            if feat_state and _norm(feat_state) not in state_alias_set:
                continue
        candidates.append(feat)

    known = _get_district_names_for_state(state_name or state)
    district_aliases = aliases.get("district") or {}

    allowed = set()
    for db_name in known:
        # Expand each DB district to its alias spellings so the older GADM
        # names still resolve (Baleshwar/Balasore, Khordha/Khurda, ...).
        allowed.update(_expand_aliases(db_name, district_aliases))

    # Every district in the state is returned, tagged with whether it belongs
    # to us. Keeping the unmatched ones is what preserves the full state
    # outline -- the client greys them instead of leaving holes.
    filtered = []
    matched_count = 0
    for feat in candidates:
        props = feat.get("properties") or {}
        feat_name = _first_present(props, name_keys)
        is_ours = bool(allowed and feat_name
                       and _expand_aliases(feat_name, district_aliases) & allowed)
        if is_ours:
            matched_count += 1

        out_feat = dict(feat)
        out_props = dict(props)
        out_props["_matched"] = is_ours
        out_props["_districtName"] = feat_name or ""
        out_feat["properties"] = out_props
        filtered.append(out_feat)

    # A state whose districts are all unmatched usually means the naming
    # diverged, not that nothing belongs to us; the client still colours by
    # its own resolver, so the full set is the safer payload either way.
    out = {
        "type": "FeatureCollection",
        "features": filtered,
        "_meta": {
            "source": url,
            "level": level,
            "scope_state": state_name,
            "count": len(filtered),
            "matched": matched_count,
            "known_districts": len(known),
        },
    }
    _cache_set(mem_cache, cache_key, out)
    return out


def _resolve_period(year=None, month=None):
    """Reporting window for a Year+Month selection.

    Returns (year, month, period_start, period_end). `period_end` is the last
    day of the month, clamped to today when the selection is the current month
    so an in-progress month never counts days that have not happened yet --
    the CURDATE() behaviour of the original report query.
    """
    today = getdate(nowdate())
    try:
        year_i = int(year) if year else today.year
        month_i = int(month) if month else today.month
    except (TypeError, ValueError):
        year_i, month_i = today.year, today.month
    if not 1 <= month_i <= 12:
        month_i = today.month

    period_start = date(year_i, month_i, 1)
    period_end = date(year_i, month_i, calendar.monthrange(year_i, month_i)[1])
    if (year_i, month_i) == (today.year, today.month):
        period_end = today
    return year_i, month_i, period_start, period_end


# ---------------------------------------------------------------------------
# Dashboard summary cards
# ---------------------------------------------------------------------------
#
# GP/Village classification is read directly off `Saturation gp` /
# `Saturation village` -- `scattered_gp`, `urban_gp`, `scattered_village`,
# `less_children_village` are authoritative flags maintained on those
# records. Only "Operational" is derived live, via a join to `tabCreche`,
# since neither doctype carries a flag of its own for it.

_OPERATIONAL_STATUS = 3

# A GP/village is "Less Children" once its total enrolled children for the
# period falls below this count.
_LESS_CHILDREN_THRESHOLD = 10


def _saturation_flag_index(doctype, name_field, flag_fields):
    """Every `Saturation gp`/`Saturation village` row's status flags, indexed
    by its own free-text name under the same exact/fuzzy/consonant tiers as
    `_operational_name_keys` -- so a Creche's Gram Panchayat/Village (a real
    Link, identified by docname and label) can be matched against this
    hand-typed name even when the spelling drifts ("Neemgaon" vs "Nimgaon").

    Returns `(exact_map, fuzzy_map, consonant_map)`, each mapping a key to
    the flags dict for the ONE row that owns it -- `None` is stored in place
    of an ambiguous consonant key (more than one row shares that skeleton)
    so `_lookup_saturation_flags` can tell "no match" apart from "matched,
    but nothing there" without a second dict of counts to check.

    Deliberately NOT cached -- see `_operational_name_keys`'s docstring.
    """
    flag_select = ", ".join(f"IFNULL(t.{f}, 0) AS {f}" for f in flag_fields)
    try:
        rows = frappe.db.sql(f"""
            SELECT t.{name_field} AS label, {flag_select}
            FROM `tab{doctype}` AS t
        """, as_dict=True)
    except Exception:
        rows = []

    exact_map = {}
    fuzzy_map = {}
    consonant_map = {}
    for row in rows:
        label = row.get("label")
        if not label:
            continue
        flags = {f: row.get(f, 0) for f in flag_fields}

        norm = _norm(label)
        if norm and norm not in exact_map:
            exact_map[norm] = flags

        fuzzy = _fuzzy_key(label)
        if fuzzy and fuzzy not in fuzzy_map:
            fuzzy_map[fuzzy] = flags

        consonant = _consonant_key(label)
        if consonant:
            # First row claims the skeleton; a second, different row sharing
            # it marks it ambiguous (None) rather than silently keeping
            # whichever arrived first.
            if consonant not in consonant_map:
                consonant_map[consonant] = flags
            elif consonant_map[consonant] is not None and consonant_map[consonant] != flags:
                consonant_map[consonant] = None

    return (exact_map, fuzzy_map, consonant_map)


def _lookup_saturation_flags(index, docname, label):
    """Looks up `_saturation_flag_index`'s result for a Creche's linked GP/
    Village, trying its docname and its label field as candidate spellings
    (mirroring `_name_matches_any`'s reasoning for which one the free-text
    `Saturation gp`/`Saturation village` entry might actually match), exact
    match before fuzzy before consonant-skeleton for each candidate in turn.
    Returns the flags dict, or `None` if nothing matched.
    """
    exact_map, fuzzy_map, consonant_map = index
    for candidate in (docname, label):
        if not candidate:
            continue
        norm = _norm(candidate)
        if norm and norm in exact_map:
            return exact_map[norm]
        fuzzy = _fuzzy_key(candidate)
        if fuzzy and fuzzy in fuzzy_map:
            return fuzzy_map[fuzzy]
        consonant = _consonant_key(candidate)
        if consonant and consonant_map.get(consonant) is not None:
            return consonant_map.get(consonant)
    return None


def _operational_name_keys(state=None, district=None, block=None):
    """Every name spelling a GP/Village with at least one operational
    (creche_status_id = _OPERATIONAL_STATUS) Creche is known under, as three
    lookup structures: exact-normalised, fuzzy, and a consonant-skeleton
    count (ambiguity, not membership, since two distinct GPs can share a
    skeleton).

    `Creche.gp_id`/`village_id` are Links to the `Gram Panchayat`/`Village`
    master doctypes, not free text -- so both the docname (`name`) and the
    master record's own label field (`gp_name`/`village_name`) are collected
    as candidate spellings for the same GP/Village. `Saturation gp`/
    `Saturation village`, by contrast, hold only a hand-typed name -- an
    exact `cr.gp_id = gp.gp_id` comparison (docname vs. free text) does not
    reliably identify the same GP, and once both sides are blank it matches
    every blank row against any operational creche whatsoever, which is what
    made every GP/Village read as Operational and starved the Scattered/
    Urban/Less-Children buckets. Blank Creche links are excluded up front so
    an unlinked creche can never contribute a match.

    Scoped to the same State/District/Block the dashboard's own filters hold:
    the fuzzy/consonant tiers are deliberately permissive (they exist to
    absorb transliteration drift within one panchayat's own spelling), and
    run India-wide they let "Kinkel" in one district match a same-sounding
    "Kinkel" operational elsewhere in the country -- silently marking a
    genuinely Scattered/Urban GP as Operational and hiding it from those
    counts. Narrowing the candidate creches to the selected scope first is
    the same discipline `_match_block_row` already applies to Block names.

    Deliberately NOT cached -- see `_saturation_flag_index`'s reasoning:
    row data, not schema, and the dashboard's own refresh-on-focus depends
    on it staying live.
    """
    scope_conditions = []
    scope_params = {"operational_status": _OPERATIONAL_STATUS}
    for column, key, value in (
        ("c.state_id", "state", state),
        ("c.district_id", "district", district),
        ("c.block_id", "block", block),
    ):
        if value:
            scope_conditions.append(f"{column} = %({key})s")
            scope_params[key] = value
    scope_clause = (" AND " + " AND ".join(scope_conditions)) if scope_conditions else ""

    def _collect(link_column, master_doctype, name_field):
        try:
            rows = frappe.db.sql(f"""
                SELECT DISTINCT m.name AS docname, m.{name_field} AS label
                FROM `tabCreche` AS c
                JOIN `tab{master_doctype}` AS m ON m.name = c.{link_column}
                WHERE c.{link_column} IS NOT NULL AND c.{link_column} != ''
                AND c.creche_status_id = %(operational_status)s
                {scope_clause}
            """, scope_params, as_dict=True)
        except Exception:
            rows = []

        exact_keys = set()
        fuzzy_keys = set()
        consonant_counts = {}
        seen_consonants_per_gp = set()
        for row in rows:
            for candidate in (row.get("docname"), row.get("label")):
                if not candidate:
                    continue
                norm = _norm(candidate)
                if norm:
                    exact_keys.add(norm)
                fuzzy = _fuzzy_key(candidate)
                if fuzzy:
                    fuzzy_keys.add(fuzzy)
                consonant = _consonant_key(candidate)
                # Counted once per distinct GP/Village (by docname), not once
                # per candidate spelling, so a GP's own docname and label
                # sharing a skeleton don't inflate it into a false ambiguity.
                dedupe_key = (row.get("docname"), consonant)
                if consonant and dedupe_key not in seen_consonants_per_gp:
                    seen_consonants_per_gp.add(dedupe_key)
                    consonant_counts[consonant] = consonant_counts.get(consonant, 0) + 1
        return exact_keys, fuzzy_keys, consonant_counts

    gp_keys = _collect("gp_id", "Gram Panchayat", "gp_name")
    village_keys = _collect("village_id", "Village", "village_name")
    return gp_keys, village_keys


def _name_matches_any(value, key_sets):
    """Does the free-text `value` (a Saturation gp/village row's own name)
    identify a GP/Village with at least one operational Creche, per
    `_operational_name_keys`?

    Exact normalised match first, then the transliteration-tolerant fuzzy
    key, then the consonant skeleton -- the same cascade `_match_block_row`
    uses for Block names -- so "Nimgaon" (the hand-typed entry) still counts
    as operational when the real, Creche-linked Gram Panchayat is spelled
    "Neemgaon". A blank `value` never matches anything, closing off the
    blank-vs-blank collision that caused every GP/Village to read Operational.
    """
    exact_keys, fuzzy_keys, consonant_keys = key_sets
    norm = _norm(value)
    if not norm:
        return False
    if norm in exact_keys:
        return True
    fuzzy = _fuzzy_key(value)
    if fuzzy and fuzzy in fuzzy_keys:
        return True
    consonant = _consonant_key(value)
    # Consonant skeletons collide far more easily than fuzzy keys (short,
    # vowel-stripped), so only trusted when exactly one operational GP/
    # Village shares it -- an ambiguous skeleton is left unmatched rather
    # than guessed, same caution `_match_block_row` applies at Block level.
    if consonant and consonant_keys.get(consonant, 0) == 1:
        return True
    return False


_SATURATION_SCOPE_LEVELS = ("state_id", "district_id", "block_id")


def _gp_village_status_rows(state=None, district=None, block=None):
    """Every `Saturation gp` / `Saturation village` row in scope, each with
    its `is_operational` flag joined on -- the authoritative per-GP/per-
    Village status data, straight from the DocTypes that actually carry it,
    independent of whether the GP/Village has any Creche rows at all.

    Shared by get_dashboard_summary (which rolls this up into counts) and
    get_gp_village_status (which the client joins against the GP/Village
    GeoJSON boundary layer by name, to colour/highlight map cells that have
    no creche and would otherwise be invisible to the map's own creche-driven
    aggregation -- see buildSiteCellLayers/aggregateSites on the JS side).

    `scattered_gp` / `urban_gp` / `scattered_village` / `less_children_village`
    are authoritative flags maintained directly on these records.
    "Operational" means: is there an operational (creche_status_id = 3)
    Creche linked to this GP/Village.

    That link cannot be tested as a plain SQL equality (`cr.gp_id =
    gp.gp_id`): `tabCreche.gp_id` is a Link storing the real Gram Panchayat's
    docname, while `Saturation gp.gp_id` is a hand-typed name ("Kinkel") --
    structurally different values, and when both happen to be blank on some
    rows the equality becomes `'' = ''`, which is TRUE in MariaDB. That
    single collision made *every* blank-gp_id GP register as Operational the
    moment any operational creche anywhere also had a blank GP link, which is
    what starved Scattered/Urban/Less-Children down to 0. Matched instead via
    _operational_name_keys/_name_matches_any -- the same exact/fuzzy/
    consonant-skeleton cascade already used for get_creche_points' map
    colours -- against the real Gram Panchayat/Village record's docname and
    label, with blank values never matching.

    Scoped by gp.state_id/district_id/block_id (v.* for villages) directly,
    matching the resolved State/District/Block docname the dashboard's own
    filters hold -- these are free-text fields on a child-table doctype, not
    Links, so this only narrows the result when a row's value happens to
    equal that docname; it never errors or excludes everything when it
    doesn't. Blank scope values are excluded explicitly so a row left blank
    can't spuriously match every district.
    """
    gp_conditions = []
    gp_params = {}
    for column, key, value in (
        ("gp.state_id", "state", state),
        ("gp.district_id", "district", district),
        ("gp.block_id", "block", block),
    ):
        if value:
            gp_conditions.append(f"{column} = %({key})s AND {column} != ''")
            gp_params[key] = value
    if _has_column("Saturation gp", "is_active"):
        # IFNULL, not a bare `= 1`: `is_active` was never part of this
        # doctype's original field list (only added, if at all, by a later
        # Customize Form), so existing rows can hold NULL rather than 1 --
        # a bare `= 1` silently drops every row saved before the column
        # existed, which is indistinguishable from the row being deleted.
        # A row is only excluded when it was explicitly unchecked.
        gp_conditions.append("IFNULL(gp.is_active, 1) = 1")
    # Saturation gp / village are planning records with no partner, and no village column on
    # the GP table: scope them by state / district / block only.
    gp_where = " WHERE " + " AND ".join(gp_conditions or ["1 = 1"]) + scope_conditions(
        "gp", gp_params, partner=False, levels=_SATURATION_SCOPE_LEVELS
    )
    gp_name_col = "gp.gp_name AS gp_name," if _has_column("Saturation gp", "gp_name") else "NULL AS gp_name,"

    gp_rows = frappe.db.sql(f"""
        SELECT
            gp.name AS name,
            gp.gp_id AS gp_id,
            {gp_name_col}
            IFNULL(gp.scattered_gp, 0) AS scattered_gp,
            IFNULL(gp.urban_gp, 0) AS urban_gp
        FROM `tabSaturation gp` AS gp
        {gp_where}
    """, gp_params, as_dict=True)

    village_conditions = []
    village_params = {}
    for column, key, value in (
        ("v.state_id", "state", state),
        ("v.district_id", "district", district),
        ("v.block_id", "block", block),
    ):
        if value:
            village_conditions.append(f"{column} = %({key})s AND {column} != ''")
            village_params[key] = value
    if _has_column("Saturation village", "is_active"):
        # Same IFNULL reasoning as the Saturation gp filter above.
        village_conditions.append("IFNULL(v.is_active, 1) = 1")
    village_where = " WHERE " + " AND ".join(village_conditions or ["1 = 1"]) + scope_conditions(
        "v", village_params, partner=False, levels=_SATURATION_SCOPE_LEVELS
    )
    village_name_col = ("v.village_name AS village_name,"
                         if _has_column("Saturation village", "village_name") else "NULL AS village_name,")

    village_rows = frappe.db.sql(f"""
        SELECT
            v.name AS name,
            v.village_id AS village_id,
            {village_name_col}
            IFNULL(v.scattered_village, 0) AS scattered_village,
            IFNULL(v.less_children_village, 0) AS less_children_village
        FROM `tabSaturation village` AS v
        {village_where}
    """, village_params, as_dict=True)

    operational_gp_keys, operational_village_keys = _operational_name_keys(state, district, block)

    gp_summary_rows = []
    for row in gp_rows:
        candidate = row.get("gp_name") or row.get("gp_id")
        row["is_operational"] = 1 if _name_matches_any(candidate, operational_gp_keys) else 0
        gp_summary_rows.append(row)

    village_summary_rows = []
    for row in village_rows:
        candidate = row.get("village_name") or row.get("village_id")
        row["is_operational"] = 1 if _name_matches_any(candidate, operational_village_keys) else 0
        village_summary_rows.append(row)

    return gp_summary_rows, village_summary_rows


@frappe.whitelist()
@scoped()
def get_gp_village_status(state=None, district=None, block=None):
    """Every Gram Panchayat / Village in scope, with its own status flags --
    for the client to join against the GP/Village GeoJSON boundary layer by
    name (fetchGPBoundaries/fetchVillageBoundaries) and colour/highlight map
    cells directly from `Saturation gp` / `Saturation village`, instead of
    only from creche rows.

    This is the fix for a GP/Village that has scattered_gp/urban_gp/
    scattered_village/less_children_village set but zero linked creches: the
    map's own aggregation (aggregateSites/aggregateVillages on the client)
    only ever sees GPs/Villages that appear in get_creche_points, so a
    creche-less GP flagged Urban was invisible to it -- present in the
    Summary card's count (which reads this same table) but never colourable
    on the map. Each row here carries every status independently (a GP can
    be Operational AND Scattered AND Urban at once; the client decides which
    colour wins for the flat "dominant category" fill, but a highlight for
    any one metric only needs that metric's own flag).

    Returns {"gps": [{"name", "gp_id", "gp_name", "scattered_gp", "urban_gp",
    "is_operational"}], "villages": [{"name", "village_id", "village_name",
    "scattered_village", "less_children_village", "is_operational"}]} --
    `gp_name`/`village_name` (when the doctype has that column) is the
    preferred match/display candidate; `gp_id`/`village_id` (hand-typed,
    sometimes just a bare number) is the fallback. The client's own fuzzy
    name matching (cleanName/fuzzyKey, mirroring _norm/_fuzzy_key here)
    joins whichever is usable against the boundary layer's _gpName/_villageName.
    """
    gp_rows, village_rows = _gp_village_status_rows(state, district, block)
    return {
        "gps": [
            {
                "name": r.get("name"),
                "gp_id": r.get("gp_id"),
                "gp_name": r.get("gp_name"),
                "scattered_gp": bool(r.get("scattered_gp")),
                "urban_gp": bool(r.get("urban_gp")),
                "is_operational": bool(r.get("is_operational")),
            }
            for r in gp_rows
        ],
        "villages": [
            {
                "name": r.get("name"),
                "village_id": r.get("village_id"),
                "village_name": r.get("village_name"),
                "scattered_village": bool(r.get("scattered_village")),
                "less_children_village": bool(r.get("less_children_village")),
                "is_operational": bool(r.get("is_operational")),
            }
            for r in village_rows
        ],
    }


@frappe.whitelist()
@scoped()
def get_dashboard_summary(year=None, month=None, state=None, district=None,
                          block=None, partner=None, c_status=None, level=None):
    """Totals + supervisor breakdown for the dashboard cards.

    Every figure is scoped to whatever State/District/Block the caller
    passes: Creches/Supervisors via tabCreche's own Link fields, GP/Village
    via gp.state_id/district_id/block_id (v.* for villages) directly.
    """
    year_i, month_i, period_start, period_end = _resolve_period(year, month)
    params = {
        "period_start": period_start,
        "period_end": period_end,
        "year": year_i,
        "month": month_i,
        "operational": _OPERATIONAL_STATUS,
    }

    conditions = ["s.is_active = 1", "d.is_active = 1"]
    for column, key, value in (
        ("c.state_id", "state", state),
        ("c.district_id", "district", district),
        ("c.block_id", "block", block),
        ("c.partner_id", "partner", partner),
        ("c.creche_status_id", "c_status", c_status),
    ):
        if value:
            conditions.append(f"{column} = %({key})s")
            params[key] = value

    if _has_column("Block", "is_active"):
        conditions.append("(c.block_id IS NULL OR c.block_id = '' OR b.is_active = 1)")

    # @scoped() has validated the filters the caller sent; this is what they get when they
    # send none: only creches inside their own partner / geography.
    where_clause = " AND ".join(conditions) + scope_conditions("c", params)

    def base_from(extra_joins=""):
        return f"""
        FROM `tabCreche` AS c
        INNER JOIN `tabState` AS s ON s.name = c.state_id
        INNER JOIN `tabDistrict` AS d ON d.name = c.district_id
        LEFT JOIN `tabBlock` AS b ON b.name = c.block_id
        {extra_joins}
        WHERE {where_clause}
    """

    gp_summary_rows, village_summary_rows = _gp_village_status_rows(state, district, block)

    creche_totals = frappe.db.sql(f"""
        SELECT
            COUNT(DISTINCT c.name) AS total_creches,
            COUNT(DISTINCT CASE WHEN c.creche_status_id = %(operational)s THEN c.name END) AS operational_creches
        {base_from()}
    """, params, as_dict=True)

    supervisors = frappe.db.sql(f"""
        SELECT
            COALESCE(NULLIF(TRIM(u.full_name), ''), 'Unassigned') AS supervisor,
            COUNT(DISTINCT c.name) AS creches,
            COUNT(DISTINCT c.village_id) AS villages,
            COUNT(DISTINCT c.gp_id) AS gps
        {base_from("LEFT JOIN `tabUser` AS u ON u.name = c.supervisor_id")}
        GROUP BY COALESCE(NULLIF(TRIM(u.full_name), ''), 'Unassigned')
        ORDER BY creches DESC, supervisor ASC
    """, params, as_dict=True)

    # Independent counts, matching the DB flags directly: a GP/village can be
    # both Operational (has a linked operational creche) and Scattered/Urban/
    # Less-Children at the same time, so each status is its own count rather
    # than a mutually-exclusive bucket. The previous "Operational beats
    # Scattered beats Urban" priority silently zeroed Scattered/Urban/
    # Less-Children out of the card whenever every flagged row also matched
    # as Operational -- which the unscoped, India-wide fuzzy name matching in
    # _operational_name_keys made the common case, not the exception.
    #
    # `total` (Gram Panchayats/Villages) is a straight row count of
    # `Saturation gp` / `Saturation village` in scope -- gp_summary_rows/
    # village_summary_rows already ARE that scoped row set (built above by
    # _gp_village_status_rows), so this is exactly COUNT(*) with no extra
    # query. A GeoJSON-boundary-derived total was tried here previously; it
    # was dropped for depending on a third-party government service that is
    # sometimes slow/unreachable and, in whole districts, does not name any
    # villages at all -- unreliable for a number that must always be there.
    gp_stats = {
        "total": len(gp_summary_rows),
        "operational": 0,
        "scattered": 0,
        "urban": 0,
    }
    for r in gp_summary_rows:
        if r.get("is_operational"):
            gp_stats["operational"] += 1
        if r.get("scattered_gp"):
            gp_stats["scattered"] += 1
        if r.get("urban_gp"):
            gp_stats["urban"] += 1

    village_stats = {
        "total": len(village_summary_rows),
        "operational": 0,
        "scattered": 0,
        "less_children": 0,
    }
    for r in village_summary_rows:
        if r.get("is_operational"):
            village_stats["operational"] += 1
        if r.get("scattered_village"):
            village_stats["scattered"] += 1
        if r.get("less_children_village"):
            village_stats["less_children"] += 1

    totals = creche_totals[0] if creche_totals else {}

    return {
        "creches": {
            "total": int(totals.get("total_creches") or 0),
            "operational": int(totals.get("operational_creches") or 0),
        },
        "gps": gp_stats,
        "villages": village_stats,
        "supervisors": supervisors,
        "period": {
            "from": str(period_start),
            "to": str(period_end),
            "year": year_i,
            "month": month_i,
        },
    }


@frappe.whitelist()
@scoped()
def get_creche_points(year=None, month=None, state=None, district=None,
                      block=None, partner=None, c_status=None):
    """Per-creche points for the block map overlays.

    Each row carries its coordinates, its supervisor, and its GP's/village's
    status flags from `Saturation gp` / `Saturation village` (`category` /
    `village_category`), which is what drives the GP-cell and Supervisor-wise
    colouring on the map -- the same source and priority the Summary cards
    use, so map and cards always agree. Creches without coordinates are
    skipped -- they cannot be placed on a map.
    """
    year_i, month_i, period_start, period_end = _resolve_period(year, month)
    params = {
        "period_start": period_start,
        "period_end": period_end,
        "year": year_i,
        "month": month_i,
        "operational": _OPERATIONAL_STATUS,
    }

    conditions = [
        "s.is_active = 1",
        "d.is_active = 1",
        "c.latitude IS NOT NULL",
        "c.longitude IS NOT NULL",
        "c.latitude != 0",
        "c.longitude != 0",
    ]
    for column, key, value in (
        ("c.state_id", "state", state),
        ("c.district_id", "district", district),
        ("c.block_id", "block", block),
        ("c.partner_id", "partner", partner),
        ("c.creche_status_id", "c_status", c_status),
    ):
        if value:
            conditions.append(f"{column} = %({key})s")
            params[key] = value

    if _has_column("Block", "is_active"):
        conditions.append("(c.block_id IS NULL OR c.block_id = '' OR b.is_active = 1)")

    where_clause = " AND ".join(conditions) + scope_conditions("c", params)

    rows = frappe.db.sql(f"""
        SELECT
            c.name AS creche_id,
            c.creche_name AS creche,
            c.latitude AS latitude,
            c.longitude AS longitude,
            COALESCE(NULLIF(TRIM(u.full_name), ''), 'Unassigned') AS supervisor,
            b.block_name AS block,
            gp.name AS gp_docname,
            gp.gp_name AS gram_panchayat,
            v.name AS village_docname,
            v.village_name AS village,
            CASE WHEN c.creche_status_id = %(operational)s THEN 1 ELSE 0 END AS is_operational
        FROM `tabCreche` AS c
        INNER JOIN `tabState` AS s ON s.name = c.state_id
        INNER JOIN `tabDistrict` AS d ON d.name = c.district_id
        LEFT JOIN `tabBlock` AS b ON b.name = c.block_id
        LEFT JOIN `tabGram Panchayat` AS gp ON gp.name = c.gp_id
        LEFT JOIN `tabVillage` AS v ON v.name = c.village_id
        LEFT JOIN `tabUser` AS u ON u.name = c.supervisor_id
        WHERE {where_clause}
        ORDER BY supervisor ASC, c.creche_name ASC
    """, params, as_dict=True)

    # `Saturation gp`/`Saturation village` hold their GP/Village as a
    # hand-typed name (see get_dashboard_summary), not a Link to the
    # `gp`/`v` records just joined above -- an exact `sgp.gp_id = c.gp_id`
    # join (the previous approach) misses whenever that free-text spelling
    # drifts from the master record's own name ("Nimgaon" vs "Neemgaon"),
    # silently leaving a real Scattered/Urban GP or Scattered/Less Children
    # Village uncoloured on the map. Matched here instead via the same
    # exact -> fuzzy -> consonant-skeleton cascade _match_block_row already
    # uses for Block names, keyed against both the GP/Village's docname and
    # its label field so either naming scheme on the master doctype works.
    gp_flags = _saturation_flag_index("Saturation gp", "gp_id", ("scattered_gp", "urban_gp"))
    village_flags = _saturation_flag_index(
        "Saturation village", "village_id", ("scattered_village", "less_children_village")
    )

    for r in rows:
        gp_match = _lookup_saturation_flags(gp_flags, r.get("gp_docname"), r.get("gram_panchayat"))
        r["scattered_gp"] = gp_match.get("scattered_gp", 0) if gp_match else 0
        r["urban_gp"] = gp_match.get("urban_gp", 0) if gp_match else 0

        village_match = _lookup_saturation_flags(village_flags, r.get("village_docname"), r.get("village"))
        r["scattered_village"] = village_match.get("scattered_village", 0) if village_match else 0
        r["less_children_village"] = village_match.get("less_children_village", 0) if village_match else 0

        r.pop("gp_docname", None)
        r.pop("village_docname", None)
        # Same priority as the Summary cards: Operational beats every other
        # status once it applies; Scattered/Urban (GP) and Scattered/Less
        # Children (village) only ever colour a *non*-operational area, and
        # only when their own flag is actually set (> 0) -- a 0/absent flag
        # must never fall through to a colour, which is what the old
        # ICDS-count rule did (any operational creche with a low child count
        # was painted "Less Children" regardless of these flags).
        if r.get("is_operational"):
            r["category"] = "operational"
        elif r.get("scattered_gp"):
            r["category"] = "scattered"
        elif r.get("urban_gp"):
            r["category"] = "urban"
        else:
            r["category"] = None

        if r.get("is_operational"):
            r["village_category"] = "operational"
        elif r.get("scattered_village"):
            r["village_category"] = "scattered"
        elif r.get("less_children_village"):
            r["village_category"] = "lessChildren"
        else:
            r["village_category"] = None

    return {
        "data": rows,
        "count": len(rows),
        "period": {"from": str(period_start), "to": str(period_end)},
    }


@frappe.whitelist()
def get_active_state_names():
    """State names with is_active = 1.

    The map uses this to outline every active state, including ones that have
    no creche data in the selected period -- otherwise a newly activated state
    stays invisible until data lands against it.
    """
    rows = frappe.db.sql(
        "SELECT name, state_name FROM `tabState` WHERE is_active = 1 ORDER BY state_name",
        as_dict=True,
    )
    return [{"id": r["name"], "name": r["state_name"]} for r in rows if r.get("state_name")]


# ---------------------------------------------------------------------------
# Creche master data
# ---------------------------------------------------------------------------

@frappe.whitelist()
@scoped()
def get_creche_master_data(year=None, month=None, c_status=None, partner=None, state=None, district=None, block=None, gp=None, village=None, supervisor_id=None, creche=None, phases=None):
    conditions = []
    params = {}

    if year and month:
        conditions.append(
            "(YEAR(c.creche_opening_date) < %(year)s"
            " OR (YEAR(c.creche_opening_date) = %(year)s AND MONTH(c.creche_opening_date) <= %(month)s))"
        )
        params["year"] = year
        params["month"] = month
    elif year:
        conditions.append("YEAR(c.creche_opening_date) <= %(year)s")
        params["year"] = year
    elif month:
        conditions.append("MONTH(c.creche_opening_date) <= %(month)s")
        params["month"] = month

    simple_filters = {
        "c.creche_status_id": ("c_status", c_status),
        "c.partner_id": ("partner", partner),
        "c.state_id": ("state", state),
        "c.district_id": ("district", district),
        "c.block_id": ("block", block),
        "c.gp_id": ("gp", gp),
        "c.village_id": ("village", village),
        "c.supervisor_id": ("supervisor_id", supervisor_id),
        "c.name": ("creche", creche),
    }
    for column, (key, value) in simple_filters.items():
        if value:
            conditions.append(f"{column} = %({key})s")
            params[key] = value

    if phases:
        if isinstance(phases, str):
            try:
                phases_list = json.loads(phases)
            except Exception:
                phases_list = phases.split(",")
        else:
            phases_list = phases
        phases_list = [p.strip() for p in (phases_list or []) if str(p).strip()]
        if phases_list:
            placeholders = []
            for idx, phase in enumerate(phases_list):
                key = f"phase_{idx}"
                placeholders.append(f"%({key})s")
                params[key] = phase
            conditions.append(f"c.phases IN ({', '.join(placeholders)})")

    # Only show creches whose State/District (and Block, where the field
    # exists) are active; inactive ones must never surface on the map even if
    # a stale creche row still points at them.
    conditions.append("s.is_active = 1")
    conditions.append("d.is_active = 1")
    if _has_column("Block", "is_active"):
        conditions.append("(c.block_id IS NULL OR c.block_id = '' OR b.is_active = 1)")

    where_clause = "WHERE " + " AND ".join(conditions) + scope_conditions("c", params)

    data = frappe.db.sql(f"""
        SELECT
            p.partner_name AS partner,
            s.state_name AS state,
            c.state_id AS state_id,
            d.district_name AS district,
            c.district_id AS district_id,
            b.block_name AS block,
            c.block_id AS block_id,
            gp.gp_name AS gram_panchayat,
            v.village_name AS village,
            u.full_name AS supervisor,
            c.creche_name AS creche,
            c.creche_id AS creche_id,
            c.latitude AS latitude,
            c.longitude AS longitude

        FROM `tabCreche` AS c

        LEFT JOIN `tabUser` AS u ON u.name = c.supervisor_id
        LEFT JOIN `tabPartner` AS p ON p.name = c.partner_id
        INNER JOIN `tabState` AS s ON s.name = c.state_id
        INNER JOIN `tabDistrict` AS d ON d.name = c.district_id
        LEFT JOIN `tabBlock` AS b ON b.name = c.block_id
        LEFT JOIN `tabGram Panchayat` AS gp ON gp.name = c.gp_id
        LEFT JOIN `tabVillage` AS v ON v.name = c.village_id
        {where_clause}
        GROUP BY
            p.partner_name,s.state_name,c.state_id,d.district_name,c.district_id,b.block_name,c.block_id,gp.gp_name,v.village_name,u.full_name,c.creche_name,c.creche_id,c.latitude,c.longitude
        ORDER BY c.creche_name ASC
    """, params, as_dict=True)

    return {
        "success": True,
        "message": "Creche master data fetched successfully",
        "filters": {
            "year": year,
            "month": month,
            "c_status": c_status
        },
        "total_count": len(data),
        "data": data
    }
