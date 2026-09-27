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
