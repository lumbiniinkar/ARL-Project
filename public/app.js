/**
 * AeroLeaf OS - Agritech Vertical Farming Operating System
 * Frontend Client & API Route Connector
 */

(function () {
  'use strict';

  // --- Configuration & Global State ---
  const STATE = {
    apiBaseUrl: localStorage.getItem('aeroleaf_api_url') || (window.location.origin.startsWith('http') ? window.location.origin : 'http://localhost:3000'),
    activeTab: 'tab-batches',
    trays: [],
    batches: [],
    pagination: { page: 1, limit: 24, total: 0, total_pages: 1 },
    batchFilters: {
      stage: 'ALL',
      crop: 'ALL',
      zone: 'ALL',
      search: '',
      page: 1,
      limit: 24
    },
    trayFilter: 'ALL',
    reportParams: {
      group_by: 'crop',
      from: '',
      to: ''
    },
    selectedGrade: 'A',
    apiLogs: [],
    health: { online: false, latency: null },
    healthTimer: null
  };

  // Crop avatars for leafy greens
  const CROP_ICONS = {
    'basil': '🌿',
    'sweet genovese basil': '🌿',
    'lettuce': '🥬',
    'butterhead': '🥬',
    'butterhead lettuce': '🥗',
    'spinach': '🍃',
    'baby spinach': '🍃',
    'kale': '🥦',
    'lacinato kale': '🥦',
    'mint': '🌱',
    'sweet mint': '🌱',
    'rocket': '🌿',
    'wild rocket': '🌿',
    'radish': '🌱',
    'micro radish': '🌱',
    'pea shoots': '🌱',
    'arugula': '🌿',
    'cilantro': '☘️'
  };

  function getCropIcon(cropName) {
    if (!cropName) return '🌱';
    const lower = cropName.toLowerCase().trim();
    for (const [key, icon] of Object.entries(CROP_ICONS)) {
      if (lower.includes(key)) return icon;
    }
    return '🥬';
  }

  // --- API Request Wrapper & Console Logger ---
  async function apiRequest(endpoint, options = {}) {
    const startTime = performance.now();
    const url = `${STATE.apiBaseUrl}${endpoint}`;
    const method = options.method || 'GET';
    const headers = options.headers || {};

    // Add default JSON header for payload requests
    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    let responseData = null;
    let statusCode = 0;
    let ok = false;
    let errorMsg = null;

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      statusCode = response.status;
      ok = response.ok;

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      if (!ok) {
        errorMsg = typeof responseData === 'object' && responseData !== null
          ? (responseData.message || responseData.error || `HTTP ${statusCode}`)
          : `HTTP ${statusCode}: ${responseData}`;
      }
    } catch (err) {
      statusCode = 0;
      ok = false;
      errorMsg = err.message || 'Network connection failure';
      responseData = { error: 'NETWORK_ERROR', message: errorMsg };
    }

    const duration = Math.round(performance.now() - startTime);

    // Record Log Entry for API Inspector
    const logItem = {
      id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toLocaleTimeString(),
      method,
      endpoint,
      url,
      requestHeaders: headers,
      requestBody: options.body ? safeJsonParse(options.body) : null,
      status: statusCode,
      duration,
      responseBody: responseData,
      ok
    };

    STATE.apiLogs.unshift(logItem);
    if (STATE.apiLogs.length > 80) STATE.apiLogs.pop();
    renderApiLogs();

    return {
      ok,
      status: statusCode,
      data: responseData,
      duration,
      error: errorMsg
    };
  }

  function safeJsonParse(val) {
    if (typeof val !== 'string') return val;
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }

  // --- API Client Methods ---
  const API = {
    async checkHealth() {
      const res = await apiRequest('/health', { method: 'GET' });
      return res;
    },

    async getTrays() {
      return await apiRequest('/trays', { method: 'GET' });
    },

    async getTray(id) {
      return await apiRequest(`/trays/${id}`, { method: 'GET' });
    },

    async createTray(trayData) {
      return await apiRequest('/trays', {
        method: 'POST',
        body: JSON.stringify(trayData)
      });
    },

    async getBatches(params = {}) {
      const query = new URLSearchParams();
      if (params.stage && params.stage !== 'ALL') query.set('stage', params.stage);
      if (params.crop && params.crop !== 'ALL') query.set('crop', params.crop);
      if (params.zone && params.zone !== 'ALL') query.set('zone', params.zone);
      if (params.page) query.set('page', params.page);
      if (params.limit) query.set('limit', params.limit);

      const qs = query.toString() ? `?${query.toString()}` : '';
      return await apiRequest(`/batches${qs}`, { method: 'GET' });
    },

    async createBatch(batchData) {
      return await apiRequest('/batches', {
        method: 'POST',
        body: JSON.stringify(batchData)
      });
    },

    async advanceStage(batchId, nextStage) {
      return await apiRequest(`/batches/${batchId}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: nextStage })
      });
    },

    async correctPreviousStage(batchId, previousStage, authorizationCode) {
      return await apiRequest(`/batches/${batchId}/stage/correction`, {
        method: 'PATCH',
        body: JSON.stringify({
          stage: previousStage,
          authorization_code: authorizationCode
        })
      });
    },

    async recordHarvest(batchId, harvestData, idempotencyKey) {
      const key = idempotencyKey || `harvest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      return await apiRequest(`/batches/${batchId}/harvest`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': key
        },
        body: JSON.stringify(harvestData)
      });
    },

    async getYieldReport(params = {}) {
      const query = new URLSearchParams();
      query.set('group_by', params.group_by || 'crop');
      if (params.from && params.to) {
        query.set('from', params.from);
        query.set('to', params.to);
      }
      return await apiRequest(`/reports/yield?${query.toString()}`, { method: 'GET' });
    }
  };

  // --- Notification Toast System ---
  function showToast(message, type = 'info', durationMs = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `
      <span style="font-size: 1.1rem;">${icon}</span>
      <div class="toast-message">${escapeHtml(message)}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(40px)';
      setTimeout(() => toast.remove(), 260);
    }, durationMs);
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return String(str ?? '');
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  // --- Health Poller ---
  async function pingHealth() {
    const indicator = document.getElementById('health-indicator');
    const textEl = document.getElementById('health-status-text');
    const latencyEl = document.getElementById('health-latency');

    const res = await API.checkHealth();
    if (res.ok && res.data && res.data.status === 'ok') {
      STATE.health.online = true;
      STATE.health.latency = res.duration;
      if (indicator) {
        indicator.className = 'health-status-badge online';
      }
      if (textEl) textEl.textContent = 'Fastify API Online';
      if (latencyEl) latencyEl.textContent = `${res.duration}ms`;
    } else {
      STATE.health.online = false;
      STATE.health.latency = null;
      if (indicator) {
        indicator.className = 'health-status-badge offline';
      }
      if (textEl) textEl.textContent = 'API Offline';
      if (latencyEl) latencyEl.textContent = 'Error';
    }
  }

  // --- Main Data Refresh ---
  async function refreshAllData() {
    await Promise.all([
      loadTrays(),
      loadBatches(),
      loadYieldReport()
    ]);
    updateKpis();
  }

  // --- Trays Operations ---
  async function loadTrays() {
    const res = await API.getTrays();
    if (res.ok && Array.isArray(res.data)) {
      STATE.trays = res.data;
      renderTrays();
      populateTrayDropdowns();
      populateFilterZones();
    } else {
      showToast(res.error || 'Failed to fetch facility trays', 'error');
    }
  }

  function renderTrays() {
    const container = document.getElementById('trays-container');
    const countEl = document.getElementById('tab-count-trays');
    if (countEl) countEl.textContent = STATE.trays.length;
    if (!container) return;

    if (STATE.trays.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
          </svg>
          <h3>No Growing Trays Registered</h3>
          <p>Register your first vertical hydroponic or aeroponic tray or click "Seed Demo Farm".</p>
          <button id="btn-empty-tray" class="btn btn-primary btn-sm">Add Tray</button>
        </div>
      `;
      document.getElementById('btn-empty-tray')?.addEventListener('click', () => openModal('modal-tray'));
      return;
    }

    // Determine occupied tray IDs from active batches (stage != 'HARVESTED')
    const activeBatchByTray = new Map();
    for (const b of STATE.batches) {
      if (b.stage !== 'HARVESTED') {
        activeBatchByTray.set(b.tray_id, b);
      }
    }

    // Apply Filter
    let filtered = STATE.trays;
    if (STATE.trayFilter === 'AVAILABLE') {
      filtered = filtered.filter(t => !activeBatchByTray.has(t.id));
    } else if (STATE.trayFilter === 'OCCUPIED') {
      filtered = filtered.filter(t => activeBatchByTray.has(t.id));
    }

    container.innerHTML = filtered.map(t => {
      const activeBatch = activeBatchByTray.get(t.id);
      const isOccupied = Boolean(activeBatch);
      const statusBadge = isOccupied
        ? `<span class="tray-status-badge occupied">Occupied</span>`
        : `<span class="tray-status-badge available">Available</span>`;

      return `
        <div class="tray-card ${isOccupied ? 'occupied' : 'available'}" data-tray-id="${escapeHtml(t.id)}">
          <div class="tray-top">
            <div>
              <div class="tray-code">${escapeHtml(t.code)}</div>
              <div class="tray-zone">${escapeHtml(t.zone)}</div>
            </div>
            ${statusBadge}
          </div>

          <div style="font-size: 0.78rem; color: var(--text-dim); display: flex; justify-content: space-between;">
            <span>Capacity Units:</span>
            <strong style="color: var(--text-main); font-family: var(--font-mono);">${t.capacity_units || 0} slots</strong>
          </div>

          ${isOccupied ? `
            <div class="tray-active-crop-info">
              <div>
                <span style="font-size: 0.72rem; color: var(--text-dim);">Active Crop:</span>
                <div style="font-weight: 700; color: var(--text-bright);">${getCropIcon(activeBatch.crop)} ${escapeHtml(activeBatch.crop)}</div>
              </div>
              <span class="badge badge-${escapeHtml(activeBatch.stage)}" style="font-size: 0.68rem;">${escapeHtml(activeBatch.stage)}</span>
            </div>
          ` : `
            <button class="btn btn-secondary btn-sm btn-quick-plant" data-tray-id="${escapeHtml(t.id)}" style="margin-top: auto;">
              <span>🌱 Plant Batch Here</span>
            </button>
          `}
        </div>
      `;
    }).join('');

    // Attach quick plant buttons
    container.querySelectorAll('.btn-quick-plant').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const trayId = e.currentTarget.getAttribute('data-tray-id');
        openBatchModalWithTray(trayId);
      });
    });
  }

  function populateTrayDropdowns() {
    const select = document.getElementById('batch-tray-id');
    const badge = document.getElementById('batch-avail-tray-count');
    if (!select) return;

    // Available trays: trays with no active batch (stage != 'HARVESTED')
    const activeTrayIds = new Set(
      STATE.batches.filter(b => b.stage !== 'HARVESTED').map(b => b.tray_id)
    );

    const availableTrays = STATE.trays.filter(t => !activeTrayIds.has(t.id));

    if (badge) {
      badge.textContent = `${availableTrays.length} Available`;
      badge.style.color = availableTrays.length > 0 ? 'var(--primary-light)' : '#f87171';
    }

    select.innerHTML = '<option value="" disabled selected>Select an unoccupied tray...</option>' +
      availableTrays.map(t => `
        <option value="${escapeHtml(t.id)}">
          ${escapeHtml(t.code)} - ${escapeHtml(t.zone)} (${t.capacity_units} units)
        </option>
      `).join('');
  }

  function populateFilterZones() {
    const zoneSelect = document.getElementById('filter-zone');
    if (!zoneSelect) return;

    const currentVal = zoneSelect.value;
    const zones = Array.from(new Set(STATE.trays.map(t => t.zone).filter(Boolean)));
    zones.sort();

    zoneSelect.innerHTML = '<option value="ALL">All Zones</option>' +
      zones.map(z => `<option value="${escapeHtml(z)}" ${currentVal === z ? 'selected' : ''}>${escapeHtml(z)}</option>`).join('');
  }

  // --- Batches Operations ---
  async function loadBatches() {
    const res = await API.getBatches(STATE.batchFilters);
    if (res.ok && res.data) {
      STATE.batches = res.data.data || [];
      STATE.pagination = res.data.pagination || { page: 1, limit: 24, total: 0, total_pages: 1 };
      renderBatches();
      populateFilterCrops();
      updatePaginationControls();
    } else {
      showToast(res.error || 'Failed to fetch batches', 'error');
    }
  }

  function renderBatches() {
    const container = document.getElementById('batches-container');
    const countEl = document.getElementById('tab-count-batches');
    if (countEl) countEl.textContent = STATE.pagination.total || STATE.batches.length;
    if (!container) return;

    // Local search filter
    let displayList = STATE.batches;
    if (STATE.batchFilters.search) {
      const q = STATE.batchFilters.search.toLowerCase();
      displayList = displayList.filter(b =>
        (b.crop && b.crop.toLowerCase().includes(q)) ||
        (b.tray_code && b.tray_code.toLowerCase().includes(q)) ||
        (b.id && b.id.toLowerCase().includes(q))
      );
    }

    if (displayList.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <h3>No Crop Batches Found</h3>
          <p>No batches match your selected stage or filters. Try clearing filters or planting a new batch.</p>
          <button id="btn-empty-batch" class="btn btn-primary btn-sm">Plant First Batch</button>
        </div>
      `;
      document.getElementById('btn-empty-batch')?.addEventListener('click', () => openModal('modal-batch'));
      return;
    }

    container.innerHTML = displayList.map(b => renderBatchCardHtml(b)).join('');

    // Attach card event listeners
    attachBatchCardListeners(container);
  }

  function renderBatchCardHtml(batch) {
    const stage = batch.stage || 'SEEDED';
    const isHarvestReady = stage === 'HARVEST_READY';
    const isHarvested = stage === 'HARVESTED';

    // Calculate progression stepper
    const stages = ['SEEDED', 'GERMINATION', 'GROWING', 'HARVEST_READY', 'HARVESTED'];
    const currentIndex = stages.indexOf(stage);

    const stepperHtml = `
      <div class="stage-stepper">
        ${stages.map((st, idx) => {
      let nodeClass = '';
      if (idx < currentIndex) nodeClass = 'completed';
      else if (idx === currentIndex) nodeClass = 'current';

      const labels = {
        'SEEDED': 'Seed',
        'GERMINATION': 'Germ',
        'GROWING': 'Grow',
        'HARVEST_READY': 'Ready',
        'HARVESTED': 'Done'
      };

      return `
            <div class="step-node ${nodeClass}" title="${st}">
              <div class="step-dot"></div>
              <span class="step-label">${labels[st]}</span>
            </div>
          `;
    }).join('')}
      </div>
    `;

    // Action button logic based on stage
    let actionBtnHtml = '';
    if (stage === 'SEEDED') {
      actionBtnHtml = `
        <button class="btn btn-secondary btn-sm btn-advance-stage" data-id="${escapeHtml(batch.id)}" data-next="GERMINATION">
          <span>Advance to GERMINATION ➔</span>
        </button>
      `;
    } else if (stage === 'GERMINATION') {
      actionBtnHtml = `
        <button class="btn btn-secondary btn-sm btn-advance-stage" data-id="${escapeHtml(batch.id)}" data-next="GROWING">
          <span>Advance to GROWING ➔</span>
        </button>
      `;
    } else if (stage === 'GROWING') {
      actionBtnHtml = `
        <button class="btn btn-secondary btn-sm btn-advance-stage" data-id="${escapeHtml(batch.id)}" data-next="HARVEST_READY">
          <span>Advance to HARVEST READY ➔</span>
        </button>
      `;
    } else if (stage === 'HARVEST_READY') {
      actionBtnHtml = `
        <button class="btn btn-amber btn-sm btn-open-harvest" data-id="${escapeHtml(batch.id)}" data-crop="${escapeHtml(batch.crop)}" data-tray="${escapeHtml(batch.tray_code || 'Tray')}">
          <span>🌾 Record Harvest (Idempotent)</span>
        </button>
      `;
    } else if (stage === 'HARVESTED') {
      actionBtnHtml = `
        <div style="font-size: 0.75rem; color: #818cf8; font-weight: 600; text-align: center; width: 100%;">
          ✓ Harvest Finalized & Tray Released
        </div>
      `;
    }

    return `
      <div class="batch-card ${isHarvestReady ? 'is-harvest-ready' : ''}" data-batch-id="${escapeHtml(batch.id)}">
        <div class="batch-card-header">
          <div class="crop-identity">
            <div class="crop-avatar">${getCropIcon(batch.crop)}</div>
            <div>
              <div class="crop-name">${escapeHtml(batch.crop)}</div>
              <div class="batch-id-tag" title="Click to copy full UUID" data-copy-id="${escapeHtml(batch.id)}">
                <span>#${escapeHtml((batch.id || '').substring(0, 8))}...</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </div>
            </div>
          </div>
          <span class="badge badge-${escapeHtml(stage)}">${escapeHtml(stage)}</span>
        </div>

        <div class="batch-location-pill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
          </svg>
          <span class="tray-code-text">${escapeHtml(batch.tray_code || 'Assigned Tray')}</span>
          <span style="color: var(--border-subtle);">•</span>
          <span class="zone-tag-text">${escapeHtml(batch.zone || 'Indoor Rack')}</span>
        </div>

        <div class="batch-timeline">
          <div class="timeline-row">
            <span>Seeded Date:</span>
            <strong>${escapeHtml(formatDateOnly(batch.seeded_on))}</strong>
          </div>
          <div class="timeline-row">
            <span>Expected Harvest:</span>
            <strong>${escapeHtml(formatDateOnly(batch.expected_harvest_on))}</strong>
          </div>
        </div>

        ${stepperHtml}

        <div class="batch-card-actions">
          ${actionBtnHtml}
        </div>
      </div>
    `;
  }

  function attachBatchCardListeners(container) {
    // Lifecycle stage circle clicks
    container.querySelectorAll('.stage-stepper .step-node').forEach(node => {
      node.addEventListener('click', () => {
        const card = node.closest('.batch-card');
        if (!card) return;

        const batchId = card.getAttribute('data-batch-id');
        const batch = STATE.batches.find(b => b.id === batchId);
        if (!batch) return;

        const stages = [
          'SEEDED',
          'GERMINATION',
          'GROWING',
          'HARVEST_READY',
          'HARVESTED'
        ];

        const currentIndex = stages.indexOf(batch.stage);
        const clickedStage = node.getAttribute('title');
        const clickedIndex = stages.indexOf(clickedStage);

        // Move exactly one stage forward
        if (
          clickedIndex === currentIndex + 1 &&
          clickedStage !== 'HARVESTED'
        ) {
          document.getElementById('stage-advance-current').textContent = batch.stage;
          document.getElementById('stage-advance-next').textContent = clickedStage;

          const confirmBtn = document.getElementById('btn-confirm-stage-advance');

          confirmBtn.onclick = async () => {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Advancing...';

            const res = await API.advanceStage(batch.id, clickedStage);

            if (res.ok) {
              closeModal('modal-stage-advance');
              showToast(`Batch moved to ${clickedStage}!`, 'success');
              await refreshAllData();
            } else {
              showToast(res.error || 'Failed to advance stage', 'error');
            }

            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm & Proceed';
          };

          openModal('modal-stage-advance');
          return;
        }

        // Move exactly one stage backward
        if (clickedIndex === currentIndex - 1) {
          document.getElementById('stage-correction-current').textContent = batch.stage;
          document.getElementById('stage-correction-previous').textContent = clickedStage;
          document.getElementById('stage-correction-code').value = '';

          const confirmBtn = document.getElementById('btn-confirm-stage-correction');

          confirmBtn.onclick = async () => {
            const code = document.getElementById('stage-correction-code').value.trim();

            if (!code) {
              showToast('Authorization code is required', 'error');
              return;
            }

            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Correcting...';

            const res = await API.correctPreviousStage(
              batch.id,
              clickedStage,
              code
            );

            if (res.ok) {
              closeModal('modal-stage-correction');
              showToast(`Batch moved back to ${clickedStage}!`, 'success');
              await refreshAllData();
            } else {
              showToast(res.error || 'Stage correction failed', 'error');
            }

            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm Correction';
          };

          openModal('modal-stage-correction');
        }
      });
    });

    // Advance Stage buttons
    container.querySelectorAll('.btn-advance-stage').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const batchId = e.currentTarget.getAttribute('data-id');
        const nextStage = e.currentTarget.getAttribute('data-next');

        btn.disabled = true;
        btn.textContent = 'Advancing...';

        const res = await API.advanceStage(batchId, nextStage);

        if (res.ok) {
          showToast(`Batch moved to ${nextStage}!`, 'success');
          await refreshAllData();
        } else {
          showToast(res.error || 'Failed to advance stage', 'error');
          btn.disabled = false;
          btn.textContent = 'Retry Advance';
        }
      });
    });





    // Record Harvest buttons
    container.querySelectorAll('.btn-open-harvest').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const crop = e.currentTarget.getAttribute('data-crop');
        const tray = e.currentTarget.getAttribute('data-tray');
        openHarvestModal(id, crop, tray);
      });
    });

    // Copy ID buttons
    container.querySelectorAll('[data-copy-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        const fullId = e.currentTarget.getAttribute('data-copy-id');
        if (navigator.clipboard) {
          navigator.clipboard.writeText(fullId);
          showToast('Copied Batch UUID to clipboard!', 'info', 2000);
        }
      });
    });
  }

  function populateFilterCrops() {
    const cropSelect = document.getElementById('filter-crop');
    if (!cropSelect) return;

    const currentVal = cropSelect.value;
    const crops = Array.from(new Set(STATE.batches.map(b => b.crop).filter(Boolean)));
    crops.sort();

    cropSelect.innerHTML = '<option value="ALL">All Crops</option>' +
      crops.map(c => `<option value="${escapeHtml(c)}" ${currentVal === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  }

  function updatePaginationControls() {
    const info = document.getElementById('pagination-info');
    const prevBtn = document.getElementById('btn-prev-page');
    const nextBtn = document.getElementById('btn-next-page');

    const p = STATE.pagination;
    if (info) {
      info.textContent = `Showing page ${p.page} of ${Math.max(1, p.total_pages)} (${p.total} total batches)`;
    }

    if (prevBtn) prevBtn.disabled = p.page <= 1;
    if (nextBtn) nextBtn.disabled = p.page >= p.total_pages;
  }

  // --- Yield & Analytics Reports ---
  async function loadYieldReport() {
    const res = await API.getYieldReport(STATE.reportParams);
    if (res.ok && res.data) {
      renderYieldAnalytics(res.data);
    } else {
      showToast(res.error || 'Failed to fetch yield report', 'error');
    }
  }

  function renderYieldAnalytics(report) {
    const data = report.data || [];
    const groupBy = report.group_by || 'crop';

    // Update Chart titles
    const titleEl = document.getElementById('report-chart-title');
    const subEl = document.getElementById('report-chart-subtitle');
    const totalTag = document.getElementById('report-chart-total-tag');
    const thGroup = document.getElementById('th-group-name');

    if (titleEl) {
      titleEl.textContent = groupBy === 'crop' ? 'Harvested Yield by Crop Variety' : 'Harvested Yield by Facility Growing Zone';
    }
    if (subEl) {
      subEl.textContent = `Grouping aggregated by ${groupBy.toUpperCase()} from database harvests table`;
    }
    if (thGroup) {
      thGroup.textContent = groupBy === 'crop' ? 'Crop Variety' : 'Growing Zone';
    }

    // Calculate totals
    const totalGrams = data.reduce((acc, row) => acc + Number(row.total_weight_grams || 0), 0);
    const totalKg = (totalGrams / 1000).toFixed(2);
    if (totalTag) {
      totalTag.textContent = `Total: ${totalKg} kg`;
    }

    // Render Visual Bar Chart
    const chartContainer = document.getElementById('yield-chart-bars');
    if (chartContainer) {
      if (data.length === 0) {
        chartContainer.innerHTML = `
          <div style="width: 100%; text-align: center; color: var(--text-dim); padding-top: 60px;">
            No finalized harvests recorded for this timeframe yet.<br>
            Advance a batch to HARVEST_READY and record a harvest to see yield analytics!
          </div>
        `;
      } else {
        const maxGrams = Math.max(...data.map(d => Number(d.total_weight_grams || 0)), 1);

        chartContainer.innerHTML = data.map(item => {
          const grams = Number(item.total_weight_grams || 0);
          const pct = Math.max(12, Math.round((grams / maxGrams) * 100));
          const kg = (grams / 1000).toFixed(2);
          const label = item.group_value || 'Unknown';

          return `
            <div class="yield-bar-column">
              <div class="yield-bar-tooltip">
                <strong>${escapeHtml(label)}</strong>: ${grams.toLocaleString()}g (${kg} kg)
              </div>
              <div class="yield-bar-fill" style="height: ${pct}%;"></div>
              <div class="yield-bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
            </div>
          `;
        }).join('');
      }
    }

    // Render Table
    const tableBody = document.getElementById('yield-table-body');
    if (tableBody) {
      if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim);">No harvest data available.</td></tr>`;
      } else {
        tableBody.innerHTML = data.map(row => {
          const grams = Number(row.total_weight_grams || 0);
          const kg = (grams / 1000).toFixed(2);
          const batches = row.harvested_batch_count || 0;
          const avgDays = row.avg_days_seeded_to_harvest || 'N/A';

          return `
            <tr>
              <td>
                <div style="display: flex; align-items: center; gap: 8px; font-weight: 600;">
                  <span>${groupBy === 'crop' ? getCropIcon(row.group_value) : '🪴'}</span>
                  <span>${escapeHtml(row.group_value)}</span>
                </div>
              </td>
              <td><strong class="mono">${batches}</strong></td>
              <td><span class="mono">${grams.toLocaleString()} g</span></td>
              <td><span class="mono" style="color: var(--primary-light); font-weight: 700;">${kg} kg</span></td>
              <td><span class="mono">${avgDays} days</span></td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  // --- Top KPI Cards Updates ---
  function updateKpis() {
    // 1. Active Batches count
    const activeBatches = STATE.batches.filter(b => b.stage !== 'HARVESTED');
    const activeCountEl = document.getElementById('kpi-active-batches');
    const activeBreakdownEl = document.getElementById('kpi-active-breakdown');
    if (activeCountEl) activeCountEl.textContent = activeBatches.length;
    if (activeBreakdownEl) activeBreakdownEl.textContent = `${activeBatches.length} In Active Pipeline`;

    // 2. Tray Occupancy
    const totalTrays = STATE.trays.length;
    const occupiedTrays = STATE.trays.filter(t =>
      activeBatches.some(b => b.tray_id === t.id)
    ).length;

    const rate = totalTrays > 0 ? Math.round((occupiedTrays / totalTrays) * 100) : 0;
    const rateEl = document.getElementById('kpi-occupancy-rate');
    const detailEl = document.getElementById('kpi-occupancy-detail');
    const barEl = document.getElementById('kpi-occupancy-bar');

    if (rateEl) rateEl.textContent = `${rate}%`;
    if (detailEl) detailEl.textContent = `${occupiedTrays} / ${totalTrays} Occupied`;
    if (barEl) barEl.style.width = `${rate}%`;

    // 3. Harvest Ready Count
    const readyBatches = STATE.batches.filter(b => b.stage === 'HARVEST_READY');
    const readyEl = document.getElementById('kpi-harvest-ready');
    if (readyEl) readyEl.textContent = readyBatches.length;

    // 4. Total Yield recorded
    const harvestedBatches = STATE.batches.filter(b => b.stage === 'HARVESTED');
    const harvestCountEl = document.getElementById('kpi-harvests-count');
    if (harvestCountEl) harvestCountEl.textContent = `${harvestedBatches.length} Harvested`;

    // Request yield stats to update the KPI number
    API.getYieldReport({ group_by: 'crop' }).then(res => {
      if (res.ok && res.data && res.data.data) {
        const totalGrams = res.data.data.reduce((acc, row) => acc + Number(row.total_weight_grams || 0), 0);
        const kg = (totalGrams / 1000).toFixed(1);
        const yieldEl = document.getElementById('kpi-total-yield');
        if (yieldEl) yieldEl.textContent = `${kg} kg`;
      }
    });
  }

  // --- Live API Inspector Logger ---
  function renderApiLogs() {
    const list = document.getElementById('drawer-logs-list');
    const fullList = document.getElementById('live-api-logs-full');
    const countBadge = document.getElementById('drawer-log-count');
    const tabBadge = document.getElementById('tab-count-api-logs');

    if (countBadge) countBadge.textContent = `${STATE.apiLogs.length} reqs`;
    if (tabBadge) tabBadge.textContent = STATE.apiLogs.length;

    const html = STATE.apiLogs.slice(0, 30).map(log => {
      let statusClass = 's2xx';
      if (log.status >= 400 && log.status < 500) statusClass = 's4xx';
      if (log.status >= 500 || log.status === 0) statusClass = 's5xx';

      return `
        <div class="log-entry" data-log-id="${log.id}">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="log-method ${log.method}">${log.method}</span>
            <span style="color: var(--text-main); font-weight: 500;">${escapeHtml(log.endpoint)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="log-status ${statusClass}">${log.status || 'ERR'}</span>
            <span style="color: var(--text-dim); font-size: 0.7rem;">${log.duration}ms</span>
            <span style="color: var(--text-dim); font-size: 0.7rem;">${log.timestamp}</span>
          </div>
        </div>
      `;
    }).join('');

    if (list) list.innerHTML = html;
    if (fullList) fullList.innerHTML = html;

    // Attach click listeners to open full JSON payload details
    document.querySelectorAll('.log-entry').forEach(el => {
      el.addEventListener('click', (e) => {
        const logId = e.currentTarget.getAttribute('data-log-id');
        const log = STATE.apiLogs.find(l => l.id === logId);
        if (log) openLogDetailModal(log);
      });
    });
  }

  function openLogDetailModal(log) {
    const modal = document.getElementById('modal-log-details');
    if (!modal) return;

    document.getElementById('log-detail-title').textContent = `${log.method} ${log.endpoint} (${log.status})`;
    document.getElementById('log-detail-endpoint').textContent = `${log.url}\nDuration: ${log.duration}ms | Timestamp: ${log.timestamp}`;

    document.getElementById('log-detail-req').textContent = JSON.stringify({
      headers: log.requestHeaders,
      body: log.requestBody
    }, null, 2);

    document.getElementById('log-detail-res').textContent = JSON.stringify(log.responseBody, null, 2);

    openModal('modal-log-details');
  }

  // --- Modal Utilities ---
  function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) {
      el.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) {
      el.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  // Close modals on clicking overlay or close buttons
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close-modal]');
    if (closeBtn) {
      const targetId = closeBtn.getAttribute('data-close-modal');
      closeModal(targetId);
      return;
    }

    if (e.target.classList.contains('modal-overlay')) {
      e.target.classList.remove('open');
      document.body.style.overflow = '';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(el => el.classList.remove('open'));
      document.body.style.overflow = '';
    }
  });

  // --- Modal Form Actions ---
  function openBatchModalWithTray(trayId) {
    populateTrayDropdowns();
    const select = document.getElementById('batch-tray-id');
    if (select && trayId) select.value = trayId;
    updateBatchPayloadPreview();
    openModal('modal-batch');
  }

  function openHarvestModal(batchId, crop, tray) {
    const inputId = document.getElementById('harvest-batch-id');
    const cropEl = document.getElementById('harvest-summary-crop');
    const trayEl = document.getElementById('harvest-summary-tray');
    const keyInput = document.getElementById('harvest-idempotency-key');
    const dateInput = document.getElementById('harvest-date');

    if (inputId) inputId.value = batchId;
    if (cropEl) cropEl.textContent = crop || 'Selected Batch';
    if (trayEl) trayEl.textContent = `Assigned Tray: ${tray || 'Facility Tray'}`;
    if (keyInput) keyInput.value = `harvest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    updateHarvestPayloadPreview();
    openModal('modal-harvest');
  }

  function updateBatchPayloadPreview() {
    const preview = document.getElementById('batch-payload-preview');
    if (!preview) return;

    const data = {
      tray_id: document.getElementById('batch-tray-id')?.value || '<select_tray_uuid>',
      crop: document.getElementById('batch-crop-name')?.value || '<crop_name>',
      seeded_on: document.getElementById('batch-seeded-on')?.value || '<YYYY-MM-DD>',
      expected_harvest_on: document.getElementById('batch-harvest-on')?.value || '<YYYY-MM-DD>'
    };

    preview.textContent = JSON.stringify(data, null, 2);
  }

  function updateHarvestPayloadPreview() {
    const preview = document.getElementById('harvest-payload-preview');
    const keyInput = document.getElementById('harvest-idempotency-key');
    if (!preview) return;

    const batchId = document.getElementById('harvest-batch-id')?.value || ':id';
    const data = {
      endpoint: `POST /batches/${batchId}/harvest`,
      header: {
        'Idempotency-Key': keyInput?.value || '<key>'
      },
      body: {
        harvested_on: document.getElementById('harvest-date')?.value || '<YYYY-MM-DD>',
        weight_grams: parseFloat(document.getElementById('harvest-weight')?.value || '1000'),
        grade: STATE.selectedGrade
      }
    };

    preview.textContent = JSON.stringify(data, null, 2);
  }

  function updateTrayPayloadPreview() {
    const preview = document.getElementById('tray-payload-preview');
    if (!preview) return;

    const data = {
      code: document.getElementById('tray-code')?.value || 'TRAY-A101',
      zone: document.getElementById('tray-zone')?.value || 'Zone A',
      capacity_units: parseInt(document.getElementById('tray-capacity')?.value || '150', 10)
    };

    preview.textContent = JSON.stringify(data, null, 2);
  }

  // --- Seed Demo Farm Routine (In-Browser Route Exercise) ---
  async function seedDemoFarm() {
    const seedBtn = document.getElementById('btn-seed-farm');
    if (seedBtn) {
      seedBtn.disabled = true;
      seedBtn.innerHTML = '<span>🌱 Seeding Farm...</span>';
    }

    showToast('Starting demo farm seeding sequence across Fastify routes...', 'info', 3000);

    const today = new Date();
    const formatDate = (d) => d.toISOString().split('T')[0];
    const daysAgo = (n) => {
      const d = new Date(today);
      d.setDate(d.getDate() - n);
      return formatDate(d);
    };
    const daysFromNow = (n) => {
      const d = new Date(today);
      d.setDate(d.getDate() + n);
      return formatDate(d);
    };

    // 1. Setup 8 Trays across zones
    const traysConfig = [
      { code: 'TRAY-A101', zone: 'Zone A - Microgreens', capacity_units: 150 },
      { code: 'TRAY-A102', zone: 'Zone A - Microgreens', capacity_units: 150 },
      { code: 'TRAY-B201', zone: 'Zone B - NFT Channels', capacity_units: 300 },
      { code: 'TRAY-B202', zone: 'Zone B - NFT Channels', capacity_units: 300 },
      { code: 'TRAY-C301', zone: 'Zone C - Deep Water Culture', capacity_units: 450 },
      { code: 'TRAY-C302', zone: 'Zone C - Deep Water Culture', capacity_units: 450 },
      { code: 'TRAY-N001', zone: 'Nursery - Germination', capacity_units: 100 },
      { code: 'TRAY-N002', zone: 'Nursery - Germination', capacity_units: 100 }
    ];

    const trayMap = new Map();
    for (const t of traysConfig) {
      const res = await API.createTray(t);
      if (res.ok && res.data && res.data.id) {
        trayMap.set(t.code, res.data.id);
      }
    }

    // Refresh existing trays to get all IDs
    const traysRes = await API.getTrays();
    if (traysRes.ok && Array.isArray(traysRes.data)) {
      traysRes.data.forEach(t => trayMap.set(t.code, t.id));
    }

    // 2. Historical Harvests (Created -> Advanced through SEEDED->GERMINATION->GROWING->HARVEST_READY -> Harvested)
    const historicalBatches = [
      { tray: 'TRAY-A101', crop: 'Pea Shoots', seeded: daysAgo(28), harvest: daysAgo(14), weight: 840.5, grade: 'A' },
      { tray: 'TRAY-B201', crop: 'Butterhead Lettuce', seeded: daysAgo(35), harvest: daysAgo(5), weight: 1450.0, grade: 'A' },
      { tray: 'TRAY-C301', crop: 'Lacinato Kale', seeded: daysAgo(42), harvest: daysAgo(7), weight: 1980.0, grade: 'A' },
      { tray: 'TRAY-A102', crop: 'Micro Radish', seeded: daysAgo(24), harvest: daysAgo(10), weight: 620.0, grade: 'B' },
      { tray: 'TRAY-B202', crop: 'Sweet Genovese Basil', seeded: daysAgo(30), harvest: daysAgo(2), weight: 1120.0, grade: 'A' }
    ];

    for (const h of historicalBatches) {
      const trayId = trayMap.get(h.tray);
      if (!trayId) continue;

      const batchRes = await API.createBatch({
        tray_id: trayId,
        crop: h.crop,
        seeded_on: h.seeded,
        expected_harvest_on: h.harvest
      });

      if (batchRes.ok && batchRes.data && batchRes.data.id) {
        const id = batchRes.data.id;
        // Advance stage step-by-step
        await API.advanceStage(id, 'GERMINATION');
        await API.advanceStage(id, 'GROWING');
        await API.advanceStage(id, 'HARVEST_READY');
        // Record Harvest with idempotency key
        await API.recordHarvest(id, {
          harvested_on: h.harvest,
          weight_grams: h.weight,
          grade: h.grade
        }, `seed-harvest-${id.substring(0, 8)}`);
      }
    }

    // 3. Active Batches at each stage
    const activeScenarios = [
      { tray: 'TRAY-A101', crop: 'Sunflower Microgreens', seeded: daysAgo(2), harvest: daysFromNow(12), targetStage: 'SEEDED' },
      { tray: 'TRAY-N001', crop: 'Sweet Mint', seeded: daysAgo(6), harvest: daysFromNow(18), targetStage: 'GERMINATION' },
      { tray: 'TRAY-B201', crop: 'Butterhead Lettuce', seeded: daysAgo(16), harvest: daysFromNow(14), targetStage: 'GROWING' },
      { tray: 'TRAY-C301', crop: 'Baby Spinach', seeded: daysAgo(25), harvest: daysFromNow(3), targetStage: 'HARVEST_READY' },
      { tray: 'TRAY-A102', crop: 'Wild Rocket', seeded: daysAgo(28), harvest: daysFromNow(0), targetStage: 'HARVEST_READY' }
    ];

    for (const a of activeScenarios) {
      const trayId = trayMap.get(a.tray);
      if (!trayId) continue;

      const batchRes = await API.createBatch({
        tray_id: trayId,
        crop: a.crop,
        seeded_on: a.seeded,
        expected_harvest_on: a.harvest
      });

      if (batchRes.ok && batchRes.data && batchRes.data.id) {
        const id = batchRes.data.id;
        if (a.targetStage === 'GERMINATION' || a.targetStage === 'GROWING' || a.targetStage === 'HARVEST_READY') {
          await API.advanceStage(id, 'GERMINATION');
        }
        if (a.targetStage === 'GROWING' || a.targetStage === 'HARVEST_READY') {
          await API.advanceStage(id, 'GROWING');
        }
        if (a.targetStage === 'HARVEST_READY') {
          await API.advanceStage(id, 'HARVEST_READY');
        }
      }
    }

    showToast('Demo farm seeded successfully with active pipeline & yield history!', 'success', 5000);
    await refreshAllData();

    if (seedBtn) {
      seedBtn.disabled = false;
      seedBtn.innerHTML = '<span>🌱 Seed Demo Farm</span>';
    }
  }

  // --- Setup Event Handlers ---
  function initEventHandlers() {
    // Navigation Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = e.currentTarget.getAttribute('data-tab');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        e.currentTarget.classList.add('active');
        const targetContent = document.getElementById(targetId);
        if (targetContent) targetContent.classList.add('active');

        if (targetId === 'tab-analytics') {
          loadYieldReport();
        }
      });
    });

    // Health indicator click -> Open API Settings Modal
    document.getElementById('health-indicator')?.addEventListener('click', () => {
      const input = document.getElementById('input-api-base-url');
      if (input) input.value = STATE.apiBaseUrl;
      openModal('modal-config');
    });

    // Save API Base URL
    document.getElementById('btn-save-api-url')?.addEventListener('click', async () => {
      const input = document.getElementById('input-api-base-url');
      if (input && input.value) {
        STATE.apiBaseUrl = input.value.trim().replace(/\/$/, '');
        localStorage.setItem('aeroleaf_api_url', STATE.apiBaseUrl);
        closeModal('modal-config');
        showToast(`API Base URL updated to ${STATE.apiBaseUrl}`, 'info');
        await pingHealth();
        await refreshAllData();
      }
    });

    // Refresh button
    document.getElementById('btn-refresh')?.addEventListener('click', async () => {
      showToast('Refreshing all farm data...', 'info', 1500);
      await refreshAllData();
    });

    // Seed Demo Farm button
    document.getElementById('btn-seed-farm')?.addEventListener('click', seedDemoFarm);

    // Open Modals
    document.getElementById('btn-open-tray-modal')?.addEventListener('click', () => {
      updateTrayPayloadPreview();
      openModal('modal-tray');
    });

    document.getElementById('btn-open-batch-modal')?.addEventListener('click', () => {
      // Default dates
      const seeded = document.getElementById('batch-seeded-on');
      const harvest = document.getElementById('batch-harvest-on');
      const today = new Date();
      if (seeded) seeded.value = today.toISOString().split('T')[0];
      if (harvest) {
        const exp = new Date(today);
        exp.setDate(exp.getDate() + 21);
        harvest.value = exp.toISOString().split('T')[0];
      }
      populateTrayDropdowns();
      updateBatchPayloadPreview();
      openModal('modal-batch');
    });

    // Batch Filters: Stage Pills
    document.querySelectorAll('.stage-pill[data-stage]').forEach(pill => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('.stage-pill[data-stage]').forEach(p => p.classList.remove('active'));
        e.currentTarget.classList.add('active');

        STATE.batchFilters.stage = e.currentTarget.getAttribute('data-stage');
        STATE.batchFilters.page = 1;
        loadBatches();
      });
    });

    // Batch Filters: Crop, Zone, Search, Limit
    document.getElementById('filter-crop')?.addEventListener('change', (e) => {
      STATE.batchFilters.crop = e.target.value;
      STATE.batchFilters.page = 1;
      loadBatches();
    });

    document.getElementById('filter-zone')?.addEventListener('change', (e) => {
      STATE.batchFilters.zone = e.target.value;
      STATE.batchFilters.page = 1;
      loadBatches();
    });

    document.getElementById('filter-search')?.addEventListener('input', (e) => {
      STATE.batchFilters.search = e.target.value;
      renderBatches();
    });

    document.getElementById('filter-limit')?.addEventListener('change', (e) => {
      STATE.batchFilters.limit = parseInt(e.target.value, 10);
      STATE.batchFilters.page = 1;
      loadBatches();
    });

    // Pagination buttons
    document.getElementById('btn-prev-page')?.addEventListener('click', () => {
      if (STATE.pagination.page > 1) {
        STATE.batchFilters.page--;
        loadBatches();
      }
    });

    document.getElementById('btn-next-page')?.addEventListener('click', () => {
      if (STATE.pagination.page < STATE.pagination.total_pages) {
        STATE.batchFilters.page++;
        loadBatches();
      }
    });

    // Tray Filters
    document.querySelectorAll('[data-tray-filter]').forEach(pill => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('[data-tray-filter]').forEach(p => p.classList.remove('active'));
        e.currentTarget.classList.add('active');
        STATE.trayFilter = e.currentTarget.getAttribute('data-tray-filter');
        renderTrays();
      });
    });

    // Yield Report: Group By
    document.getElementById('btn-group-crop')?.addEventListener('click', (e) => {
      document.getElementById('btn-group-zone')?.classList.remove('active');
      e.currentTarget.classList.add('active');
      STATE.reportParams.group_by = 'crop';
      loadYieldReport();
    });

    document.getElementById('btn-group-zone')?.addEventListener('click', (e) => {
      document.getElementById('btn-group-crop')?.classList.remove('active');
      e.currentTarget.classList.add('active');
      STATE.reportParams.group_by = 'zone';
      loadYieldReport();
    });

    // Yield Report: Date Filters
    document.getElementById('btn-apply-report-filters')?.addEventListener('click', () => {
      const from = document.getElementById('report-from')?.value;
      const to = document.getElementById('report-to')?.value;

      if ((from && !to) || (!from && to)) {
        showToast('Both From and To dates must be provided together', 'error');
        return;
      }
      if (from && to && from > to) {
        showToast('From date cannot be after To date', 'error');
        return;
      }

      STATE.reportParams.from = from || '';
      STATE.reportParams.to = to || '';
      loadYieldReport();
    });

    document.getElementById('btn-reset-report-filters')?.addEventListener('click', () => {
      const fromInput = document.getElementById('report-from');
      const toInput = document.getElementById('report-to');
      if (fromInput) fromInput.value = '';
      if (toInput) toInput.value = '';
      STATE.reportParams.from = '';
      STATE.reportParams.to = '';
      loadYieldReport();
    });

    // Bottom Drawer Toggle
    document.getElementById('drawer-toggle')?.addEventListener('click', () => {
      const drawer = document.getElementById('api-drawer');
      drawer?.classList.toggle('open');
    });

    // Clear API logs
    document.getElementById('btn-clear-api-logs')?.addEventListener('click', () => {
      STATE.apiLogs = [];
      renderApiLogs();
      showToast('API log stream cleared', 'info');
    });

    // Form: Create Tray Submission
    document.getElementById('btn-submit-tray')?.addEventListener('click', async () => {
      const codeInput = document.getElementById('tray-code');
      const zoneInput = document.getElementById('tray-zone');
      const capInput = document.getElementById('tray-capacity');

      if (!codeInput?.value.trim()) {
        showToast('Tray Code is required', 'error');
        return;
      }
      if (!zoneInput?.value.trim()) {
        showToast('Zone is required', 'error');
        return;
      }

      const payload = {
        code: codeInput.value.trim().toUpperCase(),
        zone: zoneInput.value.trim(),
        capacity_units: parseInt(capInput?.value || '100', 10)
      };

      const btn = document.getElementById('btn-submit-tray');
      btn.disabled = true;

      const res = await API.createTray(payload);
      btn.disabled = false;

      if (res.ok) {
        showToast(`Tray ${payload.code} registered!`, 'success');
        closeModal('modal-tray');
        codeInput.value = '';
        await refreshAllData();
      } else {
        showToast(res.error || 'Failed to create tray', 'error');
      }
    });

    // Form: Create Batch Submission
    document.getElementById('btn-submit-batch')?.addEventListener('click', async () => {
      const trayId = document.getElementById('batch-tray-id')?.value;
      const crop = document.getElementById('batch-crop-name')?.value.trim();
      const seededOn = document.getElementById('batch-seeded-on')?.value;
      const harvestOn = document.getElementById('batch-harvest-on')?.value;

      if (!trayId) {
        showToast('Please select an available tray', 'error');
        return;
      }
      if (!crop) {
        showToast('Crop variety name is required', 'error');
        return;
      }
      if (!seededOn || !harvestOn) {
        showToast('Both dates are required', 'error');
        return;
      }

      const payload = {
        tray_id: trayId,
        crop,
        seeded_on: seededOn,
        expected_harvest_on: harvestOn
      };

      const btn = document.getElementById('btn-submit-batch');
      btn.disabled = true;

      const res = await API.createBatch(payload);
      btn.disabled = false;

      if (res.ok) {
        showToast(`Batch ${crop} planted in tray!`, 'success');
        closeModal('modal-batch');
        document.getElementById('batch-crop-name').value = '';
        await refreshAllData();
      } else {
        showToast(res.error || 'Failed to create batch', 'error');
      }
    });

    // Form: Record Harvest Submission
    document.getElementById('btn-submit-harvest')?.addEventListener('click', async () => {
      const batchId = document.getElementById('harvest-batch-id')?.value;
      const harvestedOn = document.getElementById('harvest-date')?.value;
      const weight = parseFloat(document.getElementById('harvest-weight')?.value || '0');
      const key = document.getElementById('harvest-idempotency-key')?.value.trim();

      if (!batchId) {
        showToast('Batch ID missing', 'error');
        return;
      }
      if (!harvestedOn) {
        showToast('Harvested date required', 'error');
        return;
      }
      if (isNaN(weight) || weight <= 0) {
        showToast('Please specify a positive harvested weight in grams', 'error');
        return;
      }
      if (!key) {
        showToast('Idempotency-Key header is required', 'error');
        return;
      }

      const payload = {
        harvested_on: harvestedOn,
        weight_grams: weight,
        grade: STATE.selectedGrade
      };

      const btn = document.getElementById('btn-submit-harvest');
      btn.disabled = true;

      const res = await API.recordHarvest(batchId, payload, key);
      btn.disabled = false;

      if (res.ok) {
        showToast(`Harvest finalized: ${weight}g (${STATE.selectedGrade} Grade). Tray released!`, 'success');
        closeModal('modal-harvest');
        await refreshAllData();
      } else {
        showToast(res.error || 'Failed to record harvest', 'error');
      }
    });

    // Quick fill chips
    document.querySelectorAll('[data-fill-crop]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const val = e.currentTarget.getAttribute('data-fill-crop');
        const input = document.getElementById('batch-crop-name');
        if (input) {
          input.value = val;
          updateBatchPayloadPreview();
        }
      });
    });

    document.querySelectorAll('[data-add-days]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const days = parseInt(e.currentTarget.getAttribute('data-add-days'), 10);
        const seededInput = document.getElementById('batch-seeded-on');
        const harvestInput = document.getElementById('batch-harvest-on');

        const base = seededInput?.value ? new Date(seededInput.value) : new Date();
        base.setDate(base.getDate() + days);
        if (harvestInput) {
          harvestInput.value = base.toISOString().split('T')[0];
          updateBatchPayloadPreview();
        }
      });
    });

    document.querySelectorAll('[data-fill-zone]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const val = e.currentTarget.getAttribute('data-fill-zone');
        const input = document.getElementById('tray-zone');
        if (input) {
          input.value = val;
          updateTrayPayloadPreview();
        }
      });
    });

    document.querySelectorAll('[data-fill-weight]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const val = e.currentTarget.getAttribute('data-fill-weight');
        const input = document.getElementById('harvest-weight');
        if (input) {
          input.value = val;
          updateHarvestPayloadPreview();
        }
      });
    });

    // Regenerate Idempotency Key
    document.getElementById('btn-regen-idempotency')?.addEventListener('click', () => {
      const keyInput = document.getElementById('harvest-idempotency-key');
      if (keyInput) {
        keyInput.value = `harvest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        updateHarvestPayloadPreview();
        showToast('Generated fresh Idempotency-Key', 'info', 2000);
      }
    });

    // Quality Grade Selection
    document.querySelectorAll('.grade-option-card').forEach(card => {
      card.addEventListener('click', (e) => {
        document.querySelectorAll('.grade-option-card').forEach(c => c.classList.remove('selected'));
        const target = e.currentTarget;
        target.classList.add('selected');
        STATE.selectedGrade = target.getAttribute('data-grade') || 'A';
        updateHarvestPayloadPreview();
      });
    });

    // Realtime live input bindings for payload previews
    ['batch-tray-id', 'batch-crop-name', 'batch-seeded-on', 'batch-harvest-on'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', updateBatchPayloadPreview);
      document.getElementById(id)?.addEventListener('change', updateBatchPayloadPreview);
    });

    ['tray-code', 'tray-zone', 'tray-capacity'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', updateTrayPayloadPreview);
    });

    ['harvest-date', 'harvest-weight', 'harvest-idempotency-key'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', updateHarvestPayloadPreview);
    });
  }

  function formatDateOnly(val) {
    if (!val) return 'N/A';
    if (typeof val === 'string' && val.includes('T')) {
      return val.split('T')[0];
    }
    return String(val);
  }

  // --- Bootstrap on DOM Ready ---
  window.addEventListener('DOMContentLoaded', async () => {
    initEventHandlers();
    await pingHealth();
    await refreshAllData();

    // Start background health heartbeat every 10s
    STATE.healthTimer = setInterval(pingHealth, 10000);
  });

})();
