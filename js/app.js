/* ─── Ryo Motion App ────────────────────────────────────────────────────────
   Main application entry point — wires everything together
   ═══════════════════════════════════════════════════════════════════════════ */

const App = {
    project: null,
    isReady: false,

    init() {
        this.initUI();
        this.initEngine();
        this.loadSample();
        this.isReady = true;
        console.log('Ryo Motion ready');
    },

    initUI() {
        // Initialize viewport
        const canvas = document.getElementById('viewport');
        if (canvas) {
            Viewport.init(canvas);
        }

        // Initialize panels
        Panels.init();

        // Initialize timeline (desktop only)
        const timelineDock = document.getElementById('timelineDock');
        if (timelineDock) {
            Timeline.init(timelineDock);
        }

        // Wire viewport events
        Viewport.onTimeUpdate = (time) => {
            Timeline.setTime(time);
        };

        Viewport.onPlayStateChange = (isPlaying) => {
            // Sync UI if needed
        };

        // Wire panel events
        Panels.onLayerSelect = (layerId) => {
            Timeline.selectLayer(layerId);
        };

        // Open XML button
        const btnOpenXML = document.getElementById('btnOpenXML');
        if (btnOpenXML) {
            btnOpenXML.addEventListener('click', () => {
                const input = document.getElementById('fileInput');
                if (input) input.click();
            });
        }

        // Panel close button
        const sidePanel = document.getElementById('sidePanel');
        const btnClosePanel = document.getElementById('btnClosePanel');
        if (btnClosePanel && sidePanel) {
            btnClosePanel.addEventListener('click', () => {
                sidePanel.classList.remove('open');
            });
        }

        // Tab navigation — toggle panel on mobile
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (window.innerWidth < 900 && sidePanel) {
                    sidePanel.classList.toggle('open');
                }
            });
        });

        // Layer properties panel
        const layerPropsPanel = document.getElementById('layerPropsPanel');
        const layerPropsBody = document.getElementById('layerPropsBody');
        const layerPropsTitle = document.getElementById('layerPropsTitle');
        const btnCloseLayerProps = document.getElementById('btnCloseLayerProps');

        if (btnCloseLayerProps && layerPropsPanel) {
            btnCloseLayerProps.addEventListener('click', () => {
                layerPropsPanel.classList.remove('open');
            });
        }

        // Show layer properties when layer is selected
        Panels.onLayerSelect = (layerId) => {
            Timeline.selectLayer(layerId);
            if (layerPropsPanel && layerPropsBody) {
                const layer = this.project?.layers.find(l => l.id === layerId);
                if (layer) {
                    this.showLayerProperties(layer);
                    layerPropsPanel.classList.add('open');
                }
            }
        };
    },

    showLayerProperties(layer) {
        const layerPropsBody = document.getElementById('layerPropsBody');
        const layerPropsTitle = document.getElementById('layerPropsTitle');
        if (!layerPropsBody || !layerPropsTitle) return;

        layerPropsTitle.textContent = layer.name;

        let html = '';

        // Transform section
        html += '<div class="layer-props-field"><label>Position X</label>';
        html += `<input type="range" min="-500" max="500" value="${layer.transform.x}" data-prop="x" data-layer="${layer.id}">`;
        html += `<span class="range-value">${layer.transform.x.toFixed(0)}</span></div>`;

        html += '<div class="layer-props-field"><label>Position Y</label>';
        html += `<input type="range" min="-500" max="500" value="${layer.transform.y}" data-prop="y" data-layer="${layer.id}">`;
        html += `<span class="range-value">${layer.transform.y.toFixed(0)}</span></div>`;

        html += '<div class="layer-props-field"><label>Scale</label>';
        html += `<input type="range" min="0.1" max="3" step="0.01" value="${layer.transform.scaleX}" data-prop="scaleX" data-layer="${layer.id}">`;
        html += `<span class="range-value">${layer.transform.scaleX.toFixed(2)}x</span></div>`;

        html += '<div class="layer-props-field"><label>Rotation</label>';
        html += `<input type="range" min="-180" max="180" value="${layer.transform.rotation}" data-prop="rotation" data-layer="${layer.id}">`;
        html += `<span class="range-value">${layer.transform.rotation.toFixed(0)}°</span></div>`;

        html += '<div class="layer-props-field"><label>Opacity</label>';
        html += `<input type="range" min="0" max="1" step="0.01" value="${layer.transform.opacity}" data-prop="opacity" data-layer="${layer.id}">`;
        html += `<span class="range-value">${(layer.transform.opacity * 100).toFixed(0)}%</span></div>`;

        // Shape color
        if (layer.shapeData && layer.shapeData.fillEnabled) {
            html += '<div class="layer-props-field"><label>Fill Color</label>';
            html += `<div class="layer-props-color"><input type="color" value="${layer.shapeData.fill}" data-prop="fill" data-layer="${layer.id}">`;
            html += `<span class="range-value">${layer.shapeData.fill}</span></div></div>`;
        }

        // Text properties
        if (layer.textData) {
            html += '<div class="layer-props-field"><label>Text</label>';
            html += `<input type="text" value="${layer.textData.text.replace(/"/g, '&quot;')}" data-prop="text" data-layer="${layer.id}" style="width:100%;padding:8px;background:var(--bg-deep);border:1px solid var(--border-default);border-radius:8px;color:var(--text-primary);font-size:0.82rem;"></div>`;

            html += '<div class="layer-props-field"><label>Font Size</label>';
            html += `<input type="range" min="8" max="200" value="${layer.textData.fontSize}" data-prop="fontSize" data-layer="${layer.id}">`;
            html += `<span class="range-value">${layer.textData.fontSize}px</span></div>`;

            html += '<div class="layer-props-field"><label>Text Color</label>';
            html += `<div class="layer-props-color"><input type="color" value="${layer.textData.color}" data-prop="color" data-layer="${layer.id}">`;
            html += `<span class="range-value">${layer.textData.color}</span></div></div>`;
        }

        // Actions
        html += '<div class="layer-props-actions">';
        html += `<button class="btn sm" data-action="toggle-visibility" data-layer="${layer.id}">${layer.visible ? 'Sembunyikan' : 'Tampilkan'}</button>`;
        html += `<button class="btn sm" data-action="delete-layer" data-layer="${layer.id}">Hapus</button>`;
        html += '</div>';

        layerPropsBody.innerHTML = html;

        // Bind events
        layerPropsBody.querySelectorAll('input[type="range"]').forEach(input => {
            input.addEventListener('input', (e) => {
                const prop = e.target.dataset.prop;
                const layerId = e.target.dataset.layer;
                const value = parseFloat(e.target.value);
                const targetLayer = this.project?.layers.find(l => l.id === layerId);
                if (targetLayer) {
                    if (prop === 'opacity') {
                        targetLayer.transform.opacity = value;
                    } else if (prop === 'scaleX') {
                        targetLayer.transform.scaleX = value;
                        targetLayer.transform.scaleY = value;
                    } else {
                        targetLayer.transform[prop] = value;
                    }
                    // Update display value
                    const valueDisplay = e.target.parentElement.querySelector('.range-value');
                    if (valueDisplay) {
                        if (prop === 'opacity') valueDisplay.textContent = `${(value * 100).toFixed(0)}%`;
                        else if (prop === 'scaleX') valueDisplay.textContent = `${value.toFixed(2)}x`;
                        else if (prop === 'rotation') valueDisplay.textContent = `${value.toFixed(0)}°`;
                        else valueDisplay.textContent = value.toFixed(0);
                    }
                }
            });
        });

        layerPropsBody.querySelectorAll('input[type="color"]').forEach(input => {
            input.addEventListener('input', (e) => {
                const prop = e.target.dataset.prop;
                const layerId = e.target.dataset.layer;
                const value = e.target.value;
                const targetLayer = this.project?.layers.find(l => l.id === layerId);
                if (targetLayer) {
                    if (prop === 'fill' && targetLayer.shapeData) {
                        targetLayer.shapeData.fill = value;
                    } else if (prop === 'color' && targetLayer.textData) {
                        targetLayer.textData.color = value;
                    }
                    const valueDisplay = e.target.parentElement.querySelector('.range-value');
                    if (valueDisplay) valueDisplay.textContent = value;
                }
            });
        });

        layerPropsBody.querySelectorAll('input[type="text"]').forEach(input => {
            input.addEventListener('input', (e) => {
                const prop = e.target.dataset.prop;
                const layerId = e.target.dataset.layer;
                const value = e.target.value;
                const targetLayer = this.project?.layers.find(l => l.id === layerId);
                if (targetLayer && prop === 'text' && targetLayer.textData) {
                    targetLayer.textData.text = value;
                }
            });
        });

        layerPropsBody.querySelectorAll('[data-action="toggle-visibility"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const layerId = btn.dataset.layer;
                const targetLayer = this.project?.layers.find(l => l.id === layerId);
                if (targetLayer) {
                    targetLayer.visible = !targetLayer.visible;
                    this.showLayerProperties(targetLayer);
                }
            });
        });

        layerPropsBody.querySelectorAll('[data-action="delete-layer"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const layerId = btn.dataset.layer;
                if (this.project) {
                    const index = this.project.layers.findIndex(l => l.id === layerId);
                    if (index !== -1) {
                        this.project.layers.splice(index, 1);
                        layerPropsPanel.classList.remove('open');
                    }
                }
            });
        });
    },

    initEngine() {
        // Initialize audio context on first interaction
        document.addEventListener('click', () => {
            AudioEngine.init();
        }, { once: true });
    },

    loadSample() {
        const sample = PresetParser.generateSamplePreset();
        this.setProject(sample);
    },

    setProject(project) {
        this.project = project;
        Viewport.setProject(project);
        Panels.setProject(project);
        Timeline.setProject(project);
    },

    // Public API
    getState() {
        return {
            isReady: this.isReady,
            project: this.project,
            isPlaying: Viewport.isPlaying,
            currentTime: Viewport.currentTime,
            duration: Viewport.duration
        };
    },

    play() { Viewport.play(); },
    pause() { Viewport.pause(); },
    seek(time) { Viewport.seek(time); },

    async loadPreset(source) {
        if (typeof source === 'string') {
            // URL
            const response = await fetch(source);
            const text = await response.text();
            const project = PresetParser.parse(text);
            this.setProject(project);
            return project;
        } else if (source instanceof File) {
            const text = await Utils.readFileAsText(source);
            const project = PresetParser.parse(text);
            this.setProject(project);
            return project;
        }
    },

    async export(options) {
        if (!this.project) throw new Error('No project loaded');
        return Exporter.export(this.project, options);
    }
};

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}

// Expose to global scope
window.RyoMotion = App;
