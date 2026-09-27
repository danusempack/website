/* ─── UI Panels ──────────────────────────────────────────────────────────────
   Tab panels, media gallery, layer list, and export controls
   ═══════════════════════════════════════════════════════════════════════════ */

const Panels = {
    project: null,
    mediaGallery: [],
    onLayerSelect: null,
    onMediaReplace: null,
    onExport: null,

    init() {
        this.bindTabNavigation();
        this.bindProjectTab();
        this.bindMediaTab();
        this.bindAudioTab();
        this.bindExportTab();
        this.bindSettings();
    },

    setProject(project) {
        this.project = project;
        this.renderAll();
    },

    renderAll() {
        this.renderSlotList();
        this.renderLayerList();
        this.renderTrackList();
        this.updateStatus();
    },

    // ── Tab Navigation ──────────────────────────────────────────────────────

    bindTabNavigation() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchTab(tab);
            });
        });
    },

    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        document.querySelectorAll('.pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === `pane-${tabName}`);
        });
    },

    // ── Project Tab ────────────────────────────────────────────────────────

    bindProjectTab() {
        // File input
        const fileInput = document.getElementById('fileInput');
        const dropZone = document.getElementById('dropZone');

        if (dropZone) {
            dropZone.addEventListener('click', () => fileInput?.click());
        }

        if (fileInput) {
            fileInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files);
                for (const file of files) {
                    await this.loadXMLFile(file);
                }
            });
        }

        // Alight Motion URL
        const btnFetchAM = document.getElementById('btnFetchAM');
        if (btnFetchAM) {
            btnFetchAM.addEventListener('click', () => {
                const url = document.getElementById('inputUrlAM').value.trim();
                if (url) this.fetchFromAlight(url);
            });
        }

        // Google Drive URL
        const btnFetchDrive = document.getElementById('btnFetchDrive');
        if (btnFetchDrive) {
            btnFetchDrive.addEventListener('click', () => {
                const url = document.getElementById('inputUrlDrive').value.trim();
                if (url) this.fetchFromDrive(url);
            });
        }

        // Reset
        const btnReset = document.getElementById('btnResetPreset');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                this.loadSamplePreset();
            });
        }
    },

    async loadXMLFile(file) {
        try {
            this.showStatus('importStatus', 'Memuat file...');
            const text = await Utils.readFileAsText(file);
            const project = PresetParser.parse(text);
            this.setProject(project);
            App.setProject(project);
            this.showStatus('importStatus', `Berhasil: ${project.name} (${project.layers.length} layers)`, 'success');
        } catch (e) {
            this.showStatus('importStatus', `Error: ${e.message}`, 'error');
        }
    },

    async fetchFromAlight(url) {
        const shareId = Utils.extractAlightShareId(url);
        if (!shareId) {
            this.showStatus('amStatus', 'URL tidak valid', 'error');
            return;
        }

        try {
            this.showStatus('amStatus', 'Mengambil dari Alight Motion...');

            // Use free CORS proxy to fetch the share page
            const corsProxies = [
                `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
                `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
                `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
            ];

            let html = null;
            for (const proxyUrl of corsProxies) {
                try {
                    const response = await fetch(proxyUrl);
                    if (response.ok) {
                        const data = await response.json();
                        // allorigins returns { contents: "..." }, codetabs returns raw
                        html = data.contents || data;
                        if (html && html.length > 100) break;
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!html) {
                throw new Error('Semua CORS proxy gagal');
            }

            // Try to extract preset data from HTML
            const data = this.extractDataFromHtml(html);

            if (data) {
                const project = this.buildPresetFromData(data, url);
                this.setProject(project);
                App.setProject(project);
                this.showStatus('amStatus', `Berhasil: ${project.name} (${project.layers.length} layers)`, 'success');
            } else {
                // Fallback: try to find API endpoint in HTML
                const apiMatch = html.match(/https?:\/\/[^"'\s]+api[^"'\s]+share[^"'\s]+/i);
                if (apiMatch) {
                    const apiUrl = apiMatch[0];
                    const apiResponse = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`);
                    if (apiResponse.ok) {
                        const apiData = await apiResponse.json();
                        const parsed = JSON.parse(apiData.contents);
                        const project = this.buildPresetFromData(parsed, url);
                        this.setProject(project);
                        App.setProject(project);
                        this.showStatus('amStatus', `Berhasil: ${project.name} (${project.layers.length} layers)`, 'success');
                        return;
                    }
                }

                // Last resort: create basic preset
                const project = {
                    name: 'Alight Preset',
                    aspectRatio: '9:16',
                    fps: 30,
                    duration: 5,
                    width: 540,
                    height: 960,
                    backgroundColor: '#1a1a2e',
                    layers: [{
                        id: 'bg',
                        type: 'shape',
                        name: 'Background',
                        visible: true,
                        locked: false,
                        blendMode: 'normal',
                        opacity: 1,
                        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
                        tracks: {},
                        effects: [],
                        startTime: 0,
                        duration: 5,
                        shapeData: {
                            shapeType: 'rectangle',
                            fill: '#1a1a2e',
                            fillEnabled: true,
                            stroke: '#000000',
                            strokeWidth: 0,
                            strokeEnabled: false,
                            width: 540,
                            height: 960
                        }
                    }],
                    mediaSlots: [],
                    source: url
                };
                this.setProject(project);
                App.setProject(project);
                this.showStatus('amStatus', 'Preset dasar dimuat. Upload XML untuk data lengkap.', 'warn');
            }
        } catch (e) {
            this.showStatus('amStatus', `Error: ${e.message}. Coba upload file XML langsung.`, 'error');
        }
    },

    extractDataFromHtml(html) {
        const patterns = [
            /window\.__INITIAL_STATE__\s*=\s*({.+?});/s,
            /window\.__DATA__\s*=\s*({.+?});/s,
            /<script[^>]*id="__NEXT_DATA__"[^>]*>({.+?})<\/script>/s,
        ];
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) {
                try {
                    return JSON.parse(match[1]);
                } catch (e) {
                    continue;
                }
            }
        }
        return null;
    },

    buildPresetFromData(data, url) {
        return {
            name: data.name || data.project?.name || 'Alight Preset',
            aspectRatio: data.aspectRatio || '9:16',
            fps: data.fps || 30,
            duration: data.duration || 5,
            width: 540,
            height: 960,
            backgroundColor: '#000000',
            layers: data.layers || [],
            mediaSlots: [],
            source: url
        };
    },

    async fetchFromDrive(url) {
        const fileId = Utils.extractGoogleDriveId(url);
        if (!fileId) {
            this.showStatus('driveStatus', 'URL tidak valid', 'error');
            return;
        }

        try {
            this.showStatus('driveStatus', 'Mengambil dari Google Drive...');
            const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
            const response = await fetch(downloadUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();

            // Check if response is HTML (Google Drive preview page) instead of XML
            if (text.trim().startsWith('<') || text.includes('<!DOCTYPE html>') || text.includes('<html')) {
                // Try to extract the actual download URL from the preview page
                const confirmMatch = text.match(/confirm=([0-9A-Za-z_-]+)/);
                const uuidMatch = text.match(/uuid=([0-9a-f-]+)/);
                
                let actualUrl = downloadUrl;
                if (confirmMatch) {
                    actualUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=${confirmMatch[1]}`;
                } else if (uuidMatch) {
                    actualUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t&uuid=${uuidMatch[1]}`;
                }

                // Try with confirm parameter
                const confirmResponse = await fetch(actualUrl);
                if (confirmResponse.ok) {
                    const confirmText = await confirmResponse.text();
                    if (!confirmText.trim().startsWith('<') && !confirmText.includes('<!DOCTYPE html>')) {
                        const project = PresetParser.parse(confirmText);
                        this.setProject(project);
                        App.setProject(project);
                        this.showStatus('driveStatus', `Berhasil: ${project.name} (${project.layers.length} layers)`, 'success');
                        return;
                    }
                }

                throw new Error('Google Drive return preview page. Pastikan file di-share "Anyone with the link" atau upload XML langsung.');
            }

            const project = PresetParser.parse(text);
            this.setProject(project);
            App.setProject(project);
            this.showStatus('driveStatus', `Berhasil: ${project.name} (${project.layers.length} layers)`, 'success');
        } catch (e) {
            this.showStatus('driveStatus', `Error: ${e.message}`, 'error');
        }
    },

    loadSamplePreset() {
        const project = PresetParser.generateSamplePreset();
        this.setProject(project);
        App.setProject(project);
        this.showStatus('importStatus', 'Preset contoh dimuat', 'success');
    },

    // ── Media Tab ──────────────────────────────────────────────────────────

    bindMediaTab() {
        const mediaInput = document.getElementById('mediaInput');
        if (mediaInput) {
            mediaInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files);
                for (const file of files) {
                    await this.addMediaToGallery(file);
                }
            });
        }
    },

    async addMediaToGallery(file) {
        const url = URL.createObjectURL(file);
        const type = Utils.isImageFile(file.name) ? 'image' :
                     Utils.isVideoFile(file.name) ? 'video' :
                     Utils.isAudioFile(file.name) ? 'audio' : 'unknown';

        this.mediaGallery.push({
            id: Utils.generateId(),
            name: file.name,
            src: url,
            type,
            size: file.size
        });

        this.renderGallery();
    },

    renderGallery() {
        const grid = document.getElementById('galleryGrid');
        if (!grid) return;

        const countEl = document.getElementById('galleryCount');
        if (countEl) countEl.textContent = `${this.mediaGallery.length} file`;

        if (this.mediaGallery.length === 0) {
            grid.innerHTML = '<div class="empty-state">Belum ada media</div>';
            return;
        }

        grid.innerHTML = this.mediaGallery.map(item => `
            <div class="gallery-item" data-id="${item.id}">
                <div class="gallery-thumb">
                    ${item.type === 'image' ? `<img src="${item.src}" alt="${Utils.escapeHtml(item.name)}">` :
                      item.type === 'video' ? `<video src="${item.src}" muted></video>` :
                      `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-faint);font-size:0.6rem;">Audio</div>`}
                </div>
                <div class="gallery-meta">${Utils.escapeHtml(item.name)}</div>
            </div>
        `).join('');
    },

    renderSlotList() {
        const list = document.getElementById('slotList');
        if (!list || !this.project) return;

        const countEl = document.getElementById('slotCount');
        if (countEl) countEl.textContent = `${this.project.mediaSlots.length} slot`;

        if (this.project.mediaSlots.length === 0) {
            list.innerHTML = '<div class="empty-state">Tidak ada slot media</div>';
            return;
        }

        list.innerHTML = this.project.mediaSlots.map(slot => `
            <div class="slot-item" data-slot-id="${slot.id}">
                <div class="slot-thumb">
                    ${slot.thumbnail ? `<img src="${slot.thumbnail}" alt="">` : 'No img'}
                </div>
                <div class="slot-info">
                    <div class="slot-name">${Utils.escapeHtml(slot.name)}</div>
                    <div class="slot-type">${slot.type}</div>
                </div>
                <div class="slot-actions">
                    <button class="btn sm" data-action="replace" data-slot-id="${slot.id}">Ganti</button>
                </div>
            </div>
        `).join('');

        // Bind replace buttons
        list.querySelectorAll('[data-action="replace"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const slotId = btn.dataset.slotId;
                this.showMediaPicker(slotId);
            });
        });
    },

    showMediaPicker(slotId) {
        // Simple file picker for now
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,video/*';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                const url = URL.createObjectURL(file);
                // Update slot
                const slot = this.project.mediaSlots.find(s => s.id === slotId);
                if (slot) {
                    slot.src = url;
                    slot.thumbnail = url;
                    this.renderSlotList();
                }
            }
        };
        input.click();
    },

    // ── Audio Tab ──────────────────────────────────────────────────────────

    bindAudioTab() {
        const btnAutoSync = document.getElementById('btnAutoSync');
        if (btnAutoSync) {
            btnAutoSync.addEventListener('click', () => {
                this.autoSyncAudio();
            });
        }

        const rateInput = document.getElementById('audioRate');
        if (rateInput) {
            rateInput.addEventListener('input', (e) => {
                const rate = parseFloat(e.target.value);
                AudioEngine.setPlaybackRate(rate);
                document.getElementById('rateValue').textContent = rate.toFixed(3) + 'x';
            });
        }
    },

    autoSyncAudio() {
        if (!this.project) return;
        const audioDuration = AudioEngine.getDuration();
        if (audioDuration > 0) {
            const rate = audioDuration / this.project.duration;
            AudioEngine.setPlaybackRate(rate);
            const rateInput = document.getElementById('audioRate');
            if (rateInput) rateInput.value = rate;
            document.getElementById('rateValue').textContent = rate.toFixed(3) + 'x';
        }
    },

    renderTrackList() {
        const list = document.getElementById('trackList');
        if (!list || !this.project) return;

        const audioLayers = this.project.layers.filter(l => l.type === 'audio');

        if (audioLayers.length === 0) {
            list.innerHTML = '<div class="empty-state">Tidak ada track audio</div>';
            return;
        }

        list.innerHTML = audioLayers.map(layer => `
            <div class="track-item">
                <div class="track-header">
                    <strong>${Utils.escapeHtml(layer.name)}</strong>
                    <span class="track-time">${layer.duration.toFixed(1)}s</span>
                </div>
            </div>
        `).join('');
    },

    // ── Layers Tab ─────────────────────────────────────────────────────────

    renderLayerList() {
        const list = document.getElementById('layerList');
        if (!list || !this.project) return;

        if (this.project.layers.length === 0) {
            list.innerHTML = '<div class="empty-state">Tidak ada layer</div>';
            return;
        }

        list.innerHTML = this.project.layers.map(layer => `
            <div class="layer-item ${layer.visible ? '' : 'hidden-layer'}" data-layer-id="${layer.id}">
                <div class="layer-icon ${layer.type}">${layer.type[0].toUpperCase()}</div>
                <div class="layer-name">${Utils.escapeHtml(layer.name)}</div>
                <button class="layer-visibility" data-action="toggle-visibility" data-layer-id="${layer.id}" title="${layer.visible ? 'Sembunyikan' : 'Tampilkan'}">
                    <svg class="i sm"><use href="${layer.visible ? '#i-eye' : '#i-eyeoff'}"/></svg>
                </button>
            </div>
        `).join('');

        // Bind events
        list.querySelectorAll('.layer-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.layer-visibility')) return;
                const layerId = item.dataset.layerId;
                if (this.onLayerSelect) this.onLayerSelect(layerId);
            });
        });

        list.querySelectorAll('[data-action="toggle-visibility"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const layerId = btn.dataset.layerId;
                const layer = this.project.layers.find(l => l.id === layerId);
                if (layer) {
                    layer.visible = !layer.visible;
                    this.renderLayerList();
                }
            });
        });
    },

    // ── Export Tab ─────────────────────────────────────────────────────────

    bindExportTab() {
        const btnExport = document.getElementById('btnExport');
        if (btnExport) {
            btnExport.addEventListener('click', () => {
                this.startExport();
            });
        }
    },

    async startExport() {
        if (!this.project) {
            this.showStatus('exportStatus', 'Muat preset terlebih dahulu', 'error');
            return;
        }

        const resolution = parseInt(document.getElementById('exportResolution')?.value) || 360;
        const fps = parseInt(document.getElementById('exportFps')?.value) || 30;
        const quality = document.getElementById('exportQuality')?.value || 'medium';

        try {
            this.showStatus('exportStatus', 'Memulai ekspor...');
            const progressWrap = document.getElementById('exportProgress');
            const progressBar = document.getElementById('exportProgressBar');
            const progressLabel = document.getElementById('exportProgressLabel');

            if (progressWrap) progressWrap.hidden = false;

            Exporter.onProgress = (pct) => {
                if (progressBar) progressBar.value = pct;
                if (progressLabel) progressLabel.textContent = pct + '%';
                this.showStatus('exportStatus', `Mengekspor... ${pct}%`);
            };

            const result = await Exporter.export(this.project, { resolution, fps, quality });

            this.showStatus('exportStatus', `Selesai! Ukuran: ${(result.size / 1024 / 1024).toFixed(2)} MB`, 'success');

            // Auto download
            Utils.downloadBlob(result.blob, `ryo-motion-export.${result.blob.type.includes('mp4') ? 'mp4' : 'webm'}`);

        } catch (e) {
            this.showStatus('exportStatus', `Error: ${e.message}`, 'error');
        }
    },

    // ── Settings ───────────────────────────────────────────────────────────

    bindSettings() {
        const btnSettings = document.getElementById('btnSettings');
        const dialog = document.getElementById('settingsDialog');
        const btnClose = document.getElementById('btnCloseSettings');

        if (btnSettings && dialog) {
            btnSettings.addEventListener('click', () => dialog.showModal());
        }
        if (btnClose && dialog) {
            btnClose.addEventListener('click', () => dialog.close());
        }
        if (dialog) {
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) dialog.close();
            });
        }
    },

    // ── Helpers ────────────────────────────────────────────────────────────

    showStatus(elementId, message, type = '') {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = message;
            el.className = 'status-box' + (type ? ' ' + type : '');
        }
    },

    updateStatus() {
        if (!this.project) return;
        document.getElementById('projectSubtitle').textContent =
            `${this.project.name} — ${this.project.layers.length} layers`;
    }
};
