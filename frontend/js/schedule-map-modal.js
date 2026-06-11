// ============================================================
// ROUTEX TRANSIT — SCHEDULE MAP MODAL (FULL FIRESTORE INTEGRATION)
// Loads route data from Firestore, displays details & map.
// Read-only map view for schedules.
// ============================================================

import { getRouteById } from '../firebase/firestore-service.js';

export let routesMap = {};   // shared reference, kept for backward compatibility

let mapInstance = null;
let currentOverlay = null;

// ---------- LEAFLET HELPERS ----------
function ensureLeafletCSS() {
  if (document.getElementById('leaflet-css')) return;
  const link = document.createElement('link');
  link.id = 'leaflet-css';
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);
}

function ensureLeafletJS() {
  return new Promise((resolve) => {
    if (window.L) return resolve();
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

// ---------- BUILD MODAL HTML ----------
function buildModalHtml(schedule, routeData, fetchError) {
  const stopsDisplay = routeData?.stops?.length
    ? routeData.stops.join(' → ')
    : '—';

  const distanceDisplay = routeData?.distance != null
    ? `${routeData.distance} km`
    : '—';

  const travelTimeDisplay = routeData?.estimatedTravelTime || '—';

  let mapSectionHtml = '';

  if (fetchError) {
    mapSectionHtml = `
            <div class="schedule-map-error-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p>Failed to load route data.</p>
                <span>${fetchError}</span>
            </div>`;
  } else if (!routeData) {
    mapSectionHtml = `
            <div class="schedule-map-error-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p>Route data not available.</p>
            </div>`;
  } else if (!routeData.mapGenerated) {
    mapSectionHtml = `
            <div class="schedule-map-error-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
                    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                    <line x1="8" y1="2" x2="8" y2="18"/>
                    <line x1="16" y1="6" x2="16" y2="22"/>
                </svg>
                <p>Route map not generated yet.</p>
            </div>`;
  } else if (!routeData.coordinates || routeData.coordinates.length === 0) {
    mapSectionHtml = `
            <div class="schedule-map-error-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p>No route data available.</p>
            </div>`;
  } else {
    mapSectionHtml = `<div id="scheduleMapContainer" class="schedule-map-container"></div>`;
  }

  return `
    <div class="modal-overlay" id="scheduleMapModalOverlay" role="dialog" aria-modal="true" aria-labelledby="scheduleMapModalTitle">
        <div class="modal-container schedule-map-modal-container glass-panel">
            <div class="modal-header">
                <div class="modal-header-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                        <line x1="8" y1="2" x2="8" y2="18"/>
                        <line x1="16" y1="6" x2="16" y2="22"/>
                    </svg>
                </div>
                <h2 class="modal-title" id="scheduleMapModalTitle">Route Map</h2>
                <button class="modal-close-btn" id="scheduleMapModalCloseBtn" aria-label="Close modal">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="schedule-map-modal-body">
                <!-- Route Details Card -->
                <div class="schedule-route-details-card glass-panel-inner">
                    <h3 class="schedule-details-section-title">Route Details</h3>
                    <div class="schedule-details-grid">
                        <div class="schedule-detail-item">
                            <span class="schedule-detail-label">Route</span>
                            <span class="schedule-detail-value">${schedule.routeId}</span>
                        </div>
                        <div class="schedule-detail-item">
                            <span class="schedule-detail-label">Start</span>
                            <span class="schedule-detail-value">${routeData?.startPoint || '—'}</span>
                        </div>
                        <div class="schedule-detail-item">
                            <span class="schedule-detail-label">End</span>
                            <span class="schedule-detail-value">${routeData?.endPoint || '—'}</span>
                        </div>
                        <div class="schedule-detail-item schedule-detail-full">
                            <span class="schedule-detail-label">Stops</span>
                            <span class="schedule-detail-value">${stopsDisplay}</span>
                        </div>
                        <div class="schedule-detail-item">
                            <span class="schedule-detail-label">Distance</span>
                            <span class="schedule-detail-value">${distanceDisplay}</span>
                        </div>
                        <div class="schedule-detail-item">
                            <span class="schedule-detail-label">Estimated Time</span>
                            <span class="schedule-detail-value">${travelTimeDisplay}</span>
                        </div>
                    </div>
                </div>

                <!-- Schedule Times Card -->
                <div class="schedule-times-card glass-panel-inner">
                    <h3 class="schedule-details-section-title">Schedule Times</h3>
                    <div class="schedule-times-row">
                        <div class="schedule-time-block">
                            <span class="schedule-time-label">Planned Departure</span>
                            <span class="schedule-time-value">${schedule.departureTime}</span>
                        </div>
                        <div class="schedule-time-arrow">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
                                <line x1="5" y1="12" x2="19" y2="12"/>
                                <polyline points="12 5 19 12 12 19"/>
                            </svg>
                        </div>
                        <div class="schedule-time-block">
                            <span class="schedule-time-label">Planned Arrival</span>
                            <span class="schedule-time-value">${schedule.arrivalTime}</span>
                        </div>
                    </div>
                </div>

                <!-- Map Section -->
                <div class="schedule-map-wrapper">
                    ${mapSectionHtml}
                </div>
            </div>
        </div>
    </div>`;
}

// ---------- INITIALIZE MAP ----------
function initMap(routeData) {
  const mapContainer = document.getElementById('scheduleMapContainer');
  if (!mapContainer) return;

  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }

  const latlngs = routeData.coordinates.map(c => [c.lat, c.lng]);
  if (latlngs.length === 0) return;

  mapInstance = L.map('scheduleMapContainer', {
    zoomControl: true,
    dragging: true,
    scrollWheelZoom: true,
    doubleClickZoom: true,
    touchZoom: true
  }).setView(latlngs[0], 9);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(mapInstance);

  const startIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background:#16a34a; width:14px; height:14px; border-radius:50%; border:2px solid white; box-shadow:0 0 8px rgba(0,0,0,0.4);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  const stopIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background:#3b82f6; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 0 6px rgba(0,0,0,0.35);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  const endIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background:#ef4444; width:14px; height:14px; border-radius:50%; border:2px solid white; box-shadow:0 0 8px rgba(0,0,0,0.4);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  if (latlngs.length > 0) {
    L.marker(latlngs[0], { icon: startIcon })
      .addTo(mapInstance)
      .bindPopup(`<b>Start:</b> ${routeData.startPoint}`);

    for (let i = 1; i < latlngs.length - 1; i++) {
      const stopName = routeData.stops?.[i - 1] || `Stop ${i}`;
      L.marker(latlngs[i], { icon: stopIcon })
        .addTo(mapInstance)
        .bindPopup(`<b>Stop:</b> ${stopName}`);
    }

    if (latlngs.length > 1) {
      L.marker(latlngs[latlngs.length - 1], { icon: endIcon })
        .addTo(mapInstance)
        .bindPopup(`<b>End:</b> ${routeData.endPoint}`);
    }

    if (latlngs.length > 1) {
      L.polyline(latlngs, {
        color: '#6c22f5',
        weight: 4,
        opacity: 0.8,
        smoothFactor: 1
      }).addTo(mapInstance);
    }

    const bounds = L.latLngBounds(latlngs);
    mapInstance.fitBounds(bounds, { padding: [40, 40] });
    mapInstance.invalidateSize();
  }
}

// ---------- ATTACH CLOSE HANDLERS ----------
function attachCloseHandlers() {
  const closeBtn = document.getElementById('scheduleMapModalCloseBtn');
  const overlay = document.getElementById('scheduleMapModalOverlay');

  if (closeBtn) {
    closeBtn.addEventListener('click', closeMapModal);
  }

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target.id === 'scheduleMapModalOverlay') closeMapModal();
    });
  }

  document.addEventListener('keydown', handleEscapeKey);
}

function handleEscapeKey(e) {
  if (e.key === 'Escape') {
    closeMapModal();
  }
}

// ---------- PUBLIC API ----------

/**
 * Opens the schedule route map modal.
 * Fetches full route data from Firestore, displays route details,
 * schedule times, and the generated route map.
 *
 * @param {Object} schedule - The schedule object containing routeId, departureTime, arrivalTime
 */
export async function openMapModal(schedule) {
  // Remove existing modal if present
  closeMapModal();

  // Show loading state – inject a minimal modal
  const loadingHtml = `
    <div class="modal-overlay" id="scheduleMapModalOverlay" role="dialog" aria-modal="true">
        <div class="modal-container schedule-map-modal-container glass-panel" style="display:flex;align-items:center;justify-content:center;min-height:300px;">
            <div class="schedule-map-loading">
                <div class="spinner-large"></div>
                <p style="margin-top:1rem;color:var(--text-soft);font-weight:500;">Loading route map…</p>
            </div>
        </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', loadingHtml);

  currentOverlay = document.getElementById('scheduleMapModalOverlay');
  if (currentOverlay) {
    currentOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // Attach escape key for loading state too
  document.addEventListener('keydown', function loadingEscape(e) {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', loadingEscape);
      closeMapModal();
    }
  });

  // Fetch route data from Firestore
  let routeData = null;
  let fetchError = null;

  try {
    routeData = await getRouteById(schedule.routeId);
  } catch (err) {
    fetchError = err.message || 'Failed to load route data.';
  }

  // Remove loading modal
  if (currentOverlay) {
    currentOverlay.remove();
    currentOverlay = null;
  }
  document.body.style.overflow = '';

  // Build and show the final modal
  const modalHtml = buildModalHtml(schedule, routeData, fetchError);
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  currentOverlay = document.getElementById('scheduleMapModalOverlay');
  if (currentOverlay) {
    currentOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  attachCloseHandlers();

  // Initialize map if route data has coordinates and map is generated
  if (routeData && routeData.mapGenerated && routeData.coordinates?.length > 0) {
    ensureLeafletCSS();
    await ensureLeafletJS();

    // Delay to allow modal animation and DOM layout
    setTimeout(() => {
      initMap(routeData);
    }, 200);
  }
}

/**
 * Closes the schedule map modal and cleans up the Leaflet map instance.
 */
function closeMapModal() {
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }

  if (currentOverlay) {
    currentOverlay.classList.remove('active');
    currentOverlay.remove();
    currentOverlay = null;
  }

  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleEscapeKey);
}