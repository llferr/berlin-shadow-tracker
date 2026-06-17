import maplibregl from 'maplibre-gl';

// Photon is komoot's open-source geocoder, free, no API key. We bias to Berlin's bbox so
// the user can type just a street name and get the right hit.
const PHOTON_URL = 'https://photon.komoot.io/api/';
const BERLIN_BBOX = '13.05,52.33,13.78,52.68';
const BERLIN_BIAS_LNG = 13.405;
const BERLIN_BIAS_LAT = 52.52;

type PhotonProps = {
  name?: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  type?: string;
  osm_value?: string;
};

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: PhotonProps;
};

type SearchResult = { primary: string; secondary: string; lng: number; lat: number };

function formatResult(f: PhotonFeature): SearchResult {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;

  let primary: string;
  if (p.street) {
    primary = p.housenumber ? `${p.street} ${p.housenumber}` : p.street;
  } else {
    primary = p.name ?? '(unnamed)';
  }

  const secondaryBits = [
    p.postcode,
    p.district ?? p.city ?? p.county,
  ].filter(Boolean);
  return { primary, secondary: secondaryBits.join(' · '), lng, lat };
}

async function search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const url =
    `${PHOTON_URL}?q=${encodeURIComponent(query)}` +
    `&limit=6` +
    `&lang=en` +
    `&lat=${BERLIN_BIAS_LAT}&lon=${BERLIN_BIAS_LNG}` +
    `&bbox=${BERLIN_BBOX}`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`photon ${r.status}`);
  const data = (await r.json()) as { features: PhotonFeature[] };
  return data.features
    .filter((f) => {
      const [lng, lat] = f.geometry.coordinates;
      // Belt-and-suspenders: bbox bias isn't a hard filter on the API, so drop anything
      // outside Berlin client-side.
      return lng > 13.0 && lng < 13.8 && lat > 52.3 && lat < 52.7;
    })
    .map(formatResult);
}

export function initSearch(map: maplibregl.Map) {
  const input = document.getElementById('search-input') as HTMLInputElement;
  const list = document.getElementById('search-results') as HTMLUListElement;

  let debounceTimer: number | undefined;
  let currentAbort: AbortController | undefined;
  let activeIndex = -1;
  let lastResults: SearchResult[] = [];
  // Single reusable pin dropped on the picked address (honey to match the palette). The pin's
  // tip sits on the result's coordinate, which lands on the corresponding building.
  let marker: maplibregl.Marker | undefined;

  const hide = () => {
    list.classList.remove('open');
    activeIndex = -1;
  };

  const renderResults = (items: SearchResult[]) => {
    lastResults = items;
    list.innerHTML = '';
    if (items.length === 0) {
      hide();
      return;
    }
    items.forEach((item, idx) => {
      const li = document.createElement('li');
      const primary = document.createElement('span');
      primary.textContent = item.primary;
      li.appendChild(primary);
      if (item.secondary) {
        const sec = document.createElement('span');
        sec.className = 'secondary';
        sec.textContent = item.secondary;
        li.appendChild(sec);
      }
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(idx);
      });
      list.appendChild(li);
    });
    list.classList.add('open');
    activeIndex = -1;
  };

  const pick = (idx: number) => {
    const item = lastResults[idx];
    if (!item) return;
    input.value = item.primary + (item.secondary ? `, ${item.secondary}` : '');
    hide();

    // Drop / move the pin on the picked address.
    if (!marker) {
      marker = new maplibregl.Marker({ color: '#E4B359', anchor: 'bottom' });
    }
    marker.setLngLat([item.lng, item.lat]).addTo(map);

    map.flyTo({
      center: [item.lng, item.lat],
      zoom: 17.5,
      pitch: 60,
      bearing: 0,
      duration: 1200,
      essential: true,
    });
  };

  const onQuery = () => {
    const q = input.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    currentAbort?.abort();
    if (q.length < 2) {
      hide();
      return;
    }
    debounceTimer = window.setTimeout(async () => {
      currentAbort = new AbortController();
      try {
        const items = await search(q, currentAbort.signal);
        renderResults(items);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.warn('[search] error:', err);
      }
    }, 280);
  };

  input.addEventListener('input', onQuery);

  input.addEventListener('keydown', (e) => {
    if (!list.classList.contains('open')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, list.children.length - 1);
      updateActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(activeIndex >= 0 ? activeIndex : 0);
    } else if (e.key === 'Escape') {
      hide();
      input.blur();
    }
  });

  input.addEventListener('blur', () => setTimeout(hide, 180));
  input.addEventListener('focus', () => {
    if (lastResults.length > 0) list.classList.add('open');
  });

  const updateActive = () => {
    Array.from(list.children).forEach((el, i) => {
      el.classList.toggle('active', i === activeIndex);
    });
  };
}
