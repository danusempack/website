/* ─── Timeline UI ────────────────────────────────────────────────────────────
   Multi-track timeline with layer blocks, playhead, and keyframe indicators
   ═══════════════════════════════════════════════════════════════════════════ */

const Timeline = {
    container: null,
    project: null,
    currentTime: 0,
    zoom: 1,
    pixelsPerSecond: 100,
    selectedLayerId: null,
    onSeek: null,
    onSelectLayer: null,

    init(container) {
        this.container = container;
        this.render();
    },

    setProject(project) {
        this.project = project;
        this.render();
    },

    setTime(time) {
        this.currentTime = time;
        this.updatePlayhead();
    },

    setZoom(zoom) {
        this.zoom = Utils.clamp(zoom, 0.1, 10);
        this.pixelsPerSecond = 100 * this.zoom;
        this.render();
    },

    render() {
        if (!this.container || !this.project) return;

        const duration = this.project.duration;
        const totalWidth = duration * this.pixelsPerSecond;

        this.container.innerHTML = `
            <div class="timeline-toolbar">
                <h2>Timeline</h2>
                <span class="timeline-count">${this.project.layers.length} layers</span>
                <div class="timeline-zoom">
                    <input type="range" min="0.1" max="5" step="0.1" value="${this.zoom}" aria-label="Zoom timeline">
                    <span class="zoom-label">${this.zoom.toFixed(1)}x</span>
                </div>
            </div>
            <div class="timeline-body">
                <div class="timeline-ruler" style="width: ${totalWidth}px">
                    ${this.renderRuler(duration)}
                </div>
                <div class="timeline-tracks" style="width: ${totalWidth}px">
                    ${this.renderTracks()}
                </div>
                <div class="timeline-playhead" style="left: ${this.currentTime * this.pixelsPerSecond}px"></div>
            </div>
        `;

        this.bindEvents();
    },

    renderRuler(duration) {
        const step = this.getRulerStep();
        let html = '';
        for (let t = 0; t <= duration; t += step) {
            const x = t * this.pixelsPerSecond;
            const label = Utils.formatTime(t);
            html += `<div class="ruler-tick" style="left: ${x}px"><span>${label}</span></div>`;
        }
        return html;
    },

    getRulerStep() {
        if (this.pixelsPerSecond > 200) return 0.5;
        if (this.pixelsPerSecond > 100) return 1;
        if (this.pixelsPerSecond > 50) return 2;
        return 5;
    },

    renderTracks() {
        if (!this.project) return '';

        return this.project.layers.map((layer, index) => {
            const isSelected = layer.id === this.selectedLayerId;
            const left = layer.startTime * this.pixelsPerSecond;
            const width = layer.duration * this.pixelsPerSecond;

            // Collect keyframe positions
            const keyframePositions = [];
            if (layer.tracks) {
                Object.values(layer.tracks).forEach(track => {
                    track.keyframes.forEach(kf => {
                        const kfX = (layer.startTime + kf.time) * this.pixelsPerSecond;
                        keyframePositions.push(kfX);
                    });
                });
            }

            return `
                <div class="timeline-track ${isSelected ? 'selected' : ''} ${!layer.visible ? 'hidden-track' : ''}" data-layer-id="${layer.id}">
                    <div class="track-label">
                        <span class="layer-icon ${layer.type}">${layer.type[0].toUpperCase()}</span>
                        <span class="track-name">${Utils.escapeHtml(layer.name)}</span>
                    </div>
                    <div class="track-block" style="left: ${left}px; width: ${width}px">
                        <span class="block-label">${Utils.escapeHtml(layer.name)}</span>
                        ${keyframePositions.map(x => `<div class="keyframe-marker" style="left: ${x - left}px"></div>`).join('')}
                    </div>
                </div>
            `;
        }).join('');
    },

    updatePlayhead() {
        const playhead = this.container.querySelector('.timeline-playhead');
        if (playhead) {
            playhead.style.left = `${this.currentTime * this.pixelsPerSecond}px`;
        }
    },

    bindEvents() {
        // Zoom control
        const zoomInput = this.container.querySelector('.timeline-zoom input');
        if (zoomInput) {
            zoomInput.addEventListener('input', (e) => {
                this.setZoom(parseFloat(e.target.value));
            });
        }

        // Track selection
        this.container.querySelectorAll('.timeline-track').forEach(track => {
            track.addEventListener('click', (e) => {
                const layerId = track.dataset.layerId;
                this.selectLayer(layerId);
            });
        });

        // Seek on ruler click
        const ruler = this.container.querySelector('.timeline-ruler');
        if (ruler) {
            ruler.addEventListener('click', (e) => {
                const rect = ruler.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const time = x / this.pixelsPerSecond;
                if (this.onSeek) {
                    this.onSeek(Utils.clamp(time, 0, this.project.duration));
                }
            });
        }
    },

    selectLayer(layerId) {
        this.selectedLayerId = layerId;
        this.container.querySelectorAll('.timeline-track').forEach(track => {
            track.classList.toggle('selected', track.dataset.layerId === layerId);
        });
        if (this.onSelectLayer) {
            this.onSelectLayer(layerId);
        }
    }
};
