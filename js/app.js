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
        if (canvas) Viewport.init(canvas);

        // Initialize panels
        Panels.init();

        // Initialize timeline
        const timelineDock = document.getElementById('timelineDock');
        if (timelineDock) Timeline.init(timelineDock);

        // Wire viewport events
        Viewport.onTimeUpdate = (time) => Timeline.setTime(time);

        // Open XML button
        const btnOpenXML = document.getElementById('btnOpenXML');
        if (btnOpenXML) {
            btnOpenXML.addEventListener('click', () => {
                document.getElementById('fileInput')?.click();
            });
        }

        // Layer selection → show properties
        const layerList = document.getElementById('layerList');
        if (layerList) {
            layerList.addEventListener('click', (e) => {
                const item = e.target.closest('.layer-item');
                if (!item || e.target.closest('.layer-visibility')) return;
                const layerId = item.dataset.layerId;
                this.selectLayer(layerId);
            });
        }

        // Layer properties panel close
        const btnClose = document.getElementById('btnCloseLayerProps');
        const panel = document.getElementById('layerPropsPanel');
        if (btnClose && panel) {
            btnClose.addEventListener('click', () => panel.classList.remove('open'));
        }

        // Layer properties panel — event delegation
        const propsBody = document.getElementById('layerPropsBody');
        if (propsBody) {
            propsBody.addEventListener('input', (e) => {
                const input = e.target;
                if (!input.dataset?.layer) return;
                this.updateLayerProperty(input.dataset.layer, input.dataset.prop, input.type === 'range' ? parseFloat(input.value) : input.value, input);
            });

            propsBody.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                this.handleLayerAction(btn.dataset.action, btn.dataset.layer);
            });
        }

        // Debug panel close
        const btnCloseDebug = document.getElementById('btnCloseDebug');
        const debugPanel = document.getElementById('debugPanel');
        if (btnCloseDebug && debugPanel) {
            btnCloseDebug.addEventListener('click', () => debugPanel.hidden = true);
        }

        // Canvas click → debug inspect
        if (canvas) {
            canvas.addEventListener('click', (e) => {
                if (Viewport.isPlaying || !this.project) return;
                const rect = canvas.getBoundingClientRect();
                this.inspectLayer(e.clientX - rect.left, e.clientY - rect.top);
            });
        }
    },

    initEngine() {
        document.addEventListener('click', () => AudioEngine.init(), { once: true });
    },

    loadSample() {
        this.setProject(PresetParser.generateSamplePreset());
    },

    setProject(project) {
        this.project = project;
        Viewport.setProject(project);
        Panels.setProject(project);
        Timeline.setProject(project);
    },

    selectLayer(layerId) {
        Timeline.selectLayer(layerId);
        const layer = this.project?.layers.find(l => l.id === layerId);
        if (layer) this.showLayerProperties(layer);
    },

    updateLayerProperty(layerId, prop, value, input) {
        const layer = this.project?.layers.find(l => l.id === layerId);
        if (!layer) return;

        if (prop === 'opacity') layer.transform.opacity = value;
        else if (prop === 'scaleX') { layer.transform.scaleX = value; layer.transform.scaleY = value; }
        else if (prop === 'fill' && layer.shapeData) layer.shapeData.fill = value;
        else if (prop === 'color' && layer.textData) layer.textData.color = value;
        else if (prop === 'text' && layer.textData) layer.textData.text = value;
        else if (prop === 'fontSize' && layer.textData) layer.textData.fontSize = value;
        else layer.transform[prop] = value;

        // Update display value
        const display = input.parentElement?.querySelector('.range-value');
        if (display) {
            if (prop === 'opacity') display.textContent = `${(value * 100).toFixed(0)}%`;
            else if (prop === 'scaleX') display.textContent = `${value.toFixed(2)}x`;
            else if (prop === 'rotation') display.textContent = `${value.toFixed(0)}°`;
            else if (prop === 'fontSize') display.textContent = `${value}px`;
            else if (prop === 'fill' || prop === 'color') display.textContent = value;
            else display.textContent = value.toFixed(0);
        }
    },

    handleLayerAction(action, layerId) {
        const layer = this.project?.layers.find(l => l.id === layerId);
        if (!layer) return;
        if (action === 'toggle-visibility') { layer.visible = !layer.visible; this.showLayerProperties(layer); }
        else if (action === 'delete-layer') {
            const i = this.project.layers.findIndex(l => l.id === layerId);
            if (i !== -1) { this.project.layers.splice(i, 1); document.getElementById('layerPropsPanel')?.classList.remove('open'); }
        }
    },

    showLayerProperties(layer) {
        const body = document.getElementById('layerPropsBody');
        const title = document.getElementById('layerPropsTitle');
        const panel = document.getElementById('layerPropsPanel');
        if (!body || !title || !panel) return;

        title.textContent = layer.name;

        let html = `<div class="layer-props-field"><label>Position X</label><input type="range" min="-500" max="500" value="${layer.transform.x}" data-prop="x" data-layer="${layer.id}"><span class="range-value">${layer.transform.x.toFixed(0)}</span></div>`;
        html += `<div class="layer-props-field"><label>Position Y</label><input type="range" min="-500" max="500" value="${layer.transform.y}" data-prop="y" data-layer="${layer.id}"><span class="range-value">${layer.transform.y.toFixed(0)}</span></div>`;
        html += `<div class="layer-props-field"><label>Scale</label><input type="range" min="0.1" max="3" step="0.01" value="${layer.transform.scaleX}" data-prop="scaleX" data-layer="${layer.id}"><span class="range-value">${layer.transform.scaleX.toFixed(2)}x</span></div>`;
        html += `<div class="layer-props-field"><label>Rotation</label><input type="range" min="-180" max="180" value="${layer.transform.rotation}" data-prop="rotation" data-layer="${layer.id}"><span class="range-value">${layer.transform.rotation.toFixed(0)}°</span></div>`;
        html += `<div class="layer-props-field"><label>Opacity</label><input type="range" min="0" max="1" step="0.01" value="${layer.transform.opacity}" data-prop="opacity" data-layer="${layer.id}"><span class="range-value">${(layer.transform.opacity * 100).toFixed(0)}%</span></div>`;

        if (layer.shapeData?.fillEnabled) {
            html += `<div class="layer-props-field"><label>Fill Color</label><div class="layer-props-color"><input type="color" value="${layer.shapeData.fill}" data-prop="fill" data-layer="${layer.id}"><span class="range-value">${layer.shapeData.fill}</span></div></div>`;
        }

        if (layer.textData) {
            html += `<div class="layer-props-field"><label>Text</label><input type="text" value="${layer.textData.text.replace(/"/g, '&quot;')}" data-prop="text" data-layer="${layer.id}" style="width:100%;padding:8px;background:var(--bg-deep);border:1px solid var(--border-default);border-radius:8px;color:var(--text-primary);font-size:0.82rem;"></div>`;
            html += `<div class="layer-props-field"><label>Font Size</label><input type="range" min="8" max="200" value="${layer.textData.fontSize}" data-prop="fontSize" data-layer="${layer.id}"><span class="range-value">${layer.textData.fontSize}px</span></div>`;
            html += `<div class="layer-props-field"><label>Text Color</label><div class="layer-props-color"><input type="color" value="${layer.textData.color}" data-prop="color" data-layer="${layer.id}"><span class="range-value">${layer.textData.color}</span></div></div>`;
        }

        html += `<div class="layer-props-actions"><button class="btn sm" data-action="toggle-visibility" data-layer="${layer.id}">${layer.visible ? 'Sembunyikan' : 'Tampilkan'}</button><button class="btn sm" data-action="delete-layer" data-layer="${layer.id}">Hapus</button></div>`;

        body.innerHTML = html;
        panel.classList.add('open');
    },

    inspectLayer(x, y) {
        if (!this.project) return;
        const panel = document.getElementById('debugPanel');
        const content = document.getElementById('debugContent');
        if (!panel || !content) return;

        const layers = [...this.project.layers].reverse();
        let found = null;

        for (const layer of layers) {
            if (!layer.visible) continue;
            const t = Renderer.getAnimatedTransform(layer, Viewport.currentTime);
            const w = Renderer.getLayerWidth(layer);
            const h = Renderer.getLayerHeight(layer);
            const cx = t.x + Renderer.width / 2;
            const cy = t.y + Renderer.height / 2;
            if (x >= cx - (w * t.scaleX) / 2 && x <= cx + (w * t.scaleX) / 2 && y >= cy - (h * t.scaleY) / 2 && y <= cy + (h * t.scaleY) / 2) {
                found = layer;
                break;
            }
        }

        if (!found) {
            content.innerHTML = '<div class="debug-empty">Tidak ada layer di posisi ini</div>';
            panel.hidden = false;
            return;
        }

        const t = Renderer.getAnimatedTransform(found, Viewport.currentTime);
        let html = `<div class="debug-layer-name">${Utils.escapeHtml(found.name)}</div>`;
        html += `<div class="debug-row"><span class="debug-label">Type</span><span class="debug-value">${found.type}</span></div>`;
        html += `<div class="debug-row"><span class="debug-label">Opacity</span><span class="debug-value">${(t.opacity * 100).toFixed(0)}%</span></div>`;
        html += `<div class="debug-row"><span class="debug-label">Position</span><span class="debug-value">${t.x.toFixed(1)}, ${t.y.toFixed(1)}</span></div>`;
        html += `<div class="debug-row"><span class="debug-label">Scale</span><span class="debug-value">${t.scaleX.toFixed(2)}x</span></div>`;
        html += `<div class="debug-row"><span class="debug-label">Rotation</span><span class="debug-value">${t.rotation.toFixed(1)}°</span></div>`;

        const tracks = found.tracks || {};
        if (Object.keys(tracks).length > 0) {
            html += '<div class="debug-section"><div class="debug-section-title">Keyframes</div>';
            for (const [prop, track] of Object.entries(tracks)) {
                html += `<div class="debug-row"><span class="debug-label">${prop}</span><span class="debug-value">${track.keyframes.length} kf</span></div>`;
            }
            html += '</div>';
        }

        const effects = found.effects || [];
        if (effects.length > 0) {
            html += '<div class="debug-section"><div class="debug-section-title">Effects</div>';
            for (const effect of effects) {
                html += `<div class="debug-effect"><div class="debug-effect-name">${Utils.escapeHtml(effect.name)}</div></div>`;
            }
            html += '</div>';
        }

        if (found.shapeData) {
            html += '<div class="debug-section"><div class="debug-section-title">Shape</div>';
            html += `<div class="debug-row"><span class="debug-label">Type</span><span class="debug-value">${found.shapeData.shapeType}</span></div>`;
            html += `<div class="debug-row"><span class="debug-label">Fill</span><span class="debug-value">${found.shapeData.fill}</span></div>`;
            html += '</div>';
        }

        if (found.textData) {
            html += '<div class="debug-section"><div class="debug-section-title">Text</div>';
            html += `<div class="debug-row"><span class="debug-label">Content</span><span class="debug-value">${Utils.escapeHtml(found.textData.text)}</span></div>`;
            html += `<div class="debug-row"><span class="debug-label">Font</span><span class="debug-value">${found.textData.fontFamily} ${found.textData.fontSize}px</span></div>`;
            html += '</div>';
        }

        content.innerHTML = html;
        panel.hidden = false;
    },

    // Public API
    getState() {
        return { isReady: this.isReady, project: this.project, isPlaying: Viewport.isPlaying, currentTime: Viewport.currentTime };
    },
    play() { Viewport.play(); },
    pause() { Viewport.pause(); },
    seek(time) { Viewport.seek(time); },
};

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}

window.RyoMotion = App;
