/* ─── Viewport UI ────────────────────────────────────────────────────────────
   Canvas viewport with playback controls and drag-drop
   ═══════════════════════════════════════════════════════════════════════════ */

const Viewport = {
    canvas: null,
    project: null,
    isPlaying: false,
    currentTime: 0,
    duration: 5,
    fps: 30,
    loop: true,
    animationId: null,
    lastFrameTime: 0,
    onTimeUpdate: null,
    onPlayStateChange: null,

    init(canvas) {
        this.canvas = canvas;
        Renderer.init(canvas);
        this.bindEvents();
        this.startRenderLoop();
    },

    setProject(project) {
        this.project = project;
        this.duration = project.duration;
        this.fps = project.fps;
        this.currentTime = 0;

        // Resize canvas to match project aspect ratio
        const aspectRatio = project.width / project.height;
        const stage = document.getElementById('stage');
        if (stage) {
            const stageRect = stage.getBoundingClientRect();
            const padding = 32;
            const availW = stageRect.width - padding * 2;
            const availH = stageRect.height - padding * 2;

            let w, h;
            if (aspectRatio > 1) {
                h = availH;
                w = h * aspectRatio;
            } else {
                w = availW;
                h = w / aspectRatio;
            }

            if (w > availW) {
                w = availW;
                h = w / aspectRatio;
            }
            if (h > availH) {
                h = availH;
                w = h * aspectRatio;
            }

            Renderer.setDimensions(Math.round(w), Math.round(h));
        }

        this.updateTimecode();
    },

    bindEvents() {
        // Play/Pause
        const btnPlay = document.getElementById('btnPlay');
        if (btnPlay) {
            btnPlay.addEventListener('click', () => this.togglePlay());
        }

        // Restart
        const btnRestart = document.getElementById('btnRestart');
        if (btnRestart) {
            btnRestart.addEventListener('click', () => this.seek(0));
        }

        // Loop
        const btnLoop = document.getElementById('btnLoop');
        if (btnLoop) {
            btnLoop.addEventListener('click', () => {
                this.loop = !this.loop;
                btnLoop.classList.toggle('on', this.loop);
            });
        }

        // Seek
        const seekBar = document.getElementById('seekBar');
        if (seekBar) {
            seekBar.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                const time = (val / 1000) * this.duration;
                this.seek(time);
            });
        }

        // Seek reset
        const btnSeekReset = document.getElementById('btnSeekReset');
        if (btnSeekReset) {
            btnSeekReset.addEventListener('click', () => this.seek(0));
        }

        // Stage click to play/pause
        const stage = document.getElementById('stage');
        if (stage) {
            stage.addEventListener('click', (e) => {
                if (e.target === stage || e.target === this.canvas) {
                    this.togglePlay();
                }
            });
        }

        // Debug inspector — click on canvas to inspect layer
        if (this.canvas) {
            this.canvas.addEventListener('click', (e) => {
                if (this.isPlaying) return;
                const rect = this.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                this.inspectLayerAt(x, y);
            });
        }

        // Debug panel close
        const btnCloseDebug = document.getElementById('btnCloseDebug');
        if (btnCloseDebug) {
            btnCloseDebug.addEventListener('click', () => {
                document.getElementById('debugPanel').hidden = true;
            });
        }

        // Drag and drop
        document.addEventListener('dragenter', (e) => {
            e.preventDefault();
            document.body.classList.add('dragging');
        });

        document.addEventListener('dragleave', (e) => {
            if (e.relatedTarget === null) {
                document.body.classList.remove('dragging');
            }
        });

        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        document.addEventListener('drop', (e) => {
            e.preventDefault();
            document.body.classList.remove('dragging');
            this.handleDrop(e.dataTransfer);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    this.togglePlay();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.seek(Math.max(0, this.currentTime - (e.shiftKey ? 1 : 0.1)));
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.seek(Math.min(this.duration, this.currentTime + (e.shiftKey ? 1 : 0.1)));
                    break;
                case 'Home':
                    this.seek(0);
                    break;
                case 'End':
                    this.seek(this.duration);
                    break;
                case 'i':
                case 'I':
                    const debugPanel = document.getElementById('debugPanel');
                    if (debugPanel) debugPanel.hidden = !debugPanel.hidden;
                    break;
                case 'i':
                case 'I':
                    if (!e.ctrlKey && !e.metaKey) {
                        const debugPanel = document.getElementById('debugPanel');
                        if (debugPanel) debugPanel.hidden = !debugPanel.hidden;
                    }
                    break;
            }
        });

        // Resize
        window.addEventListener('resize', () => {
            if (this.project) this.setProject(this.project);
        });

        // Debug inspector — click on canvas to inspect layer
        this.canvas.addEventListener('click', (e) => {
            if (this.isPlaying) return;
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.inspectLayerAt(x, y);
        });

        // Debug panel close button
        const btnCloseDebug = document.getElementById('btnCloseDebug');
        if (btnCloseDebug) {
            btnCloseDebug.addEventListener('click', () => {
                document.getElementById('debugPanel').hidden = true;
            });
        }
    },

    inspectLayerAt(x, y) {
        if (!this.project) return;

        const debugPanel = document.getElementById('debugPanel');
        const debugContent = document.getElementById('debugContent');
        if (!debugPanel || !debugContent) return;

        // Find layer at position (reverse order for top-most layer)
        const layers = [...this.project.layers].reverse();
        let foundLayer = null;

        for (const layer of layers) {
            if (!layer.visible) continue;
            const transform = Renderer.getAnimatedTransform(layer, this.currentTime);
            const w = Renderer.getLayerWidth(layer);
            const h = Renderer.getLayerHeight(layer);

            // Simple bounding box check
            const cx = transform.x + Renderer.width / 2;
            const cy = transform.y + Renderer.height / 2;
            const scaleX = transform.scaleX;
            const scaleY = transform.scaleY;

            if (x >= cx - (w * scaleX) / 2 && x <= cx + (w * scaleX) / 2 &&
                y >= cy - (h * scaleY) / 2 && y <= cy + (h * scaleY) / 2) {
                foundLayer = layer;
                break;
            }
        }

        if (foundLayer) {
            this.showDebugInfo(foundLayer);
            debugPanel.hidden = false;
        } else {
            debugContent.innerHTML = '<div class="debug-empty">Tidak ada layer di posisi ini</div>';
            debugPanel.hidden = false;
        }
    },

    showDebugInfo(layer) {
        const debugContent = document.getElementById('debugContent');
        if (!debugContent) return;

        const transform = Renderer.getAnimatedTransform(layer, this.currentTime);
        const tracks = layer.tracks || {};
        const effects = layer.effects || [];

        let html = `<div class="debug-layer-name">${Utils.escapeHtml(layer.name)}</div>`;
        html += `<div class="debug-row"><span class="debug-label">Type</span><span class="debug-value">${layer.type}</span></div>`;
        html += `<div class="debug-row"><span class="debug-label">Visible</span><span class="debug-value">${layer.visible ? 'Yes' : 'No'}</span></div>`;
        html += `<div class="debug-row"><span class="debug-label">Opacity</span><span class="debug-value">${(transform.opacity * 100).toFixed(0)}%</span></div>`;
        html += `<div class="debug-row"><span class="debug-label">Position</span><span class="debug-value">${transform.x.toFixed(1)}, ${transform.y.toFixed(1)}</span></div>`;
        html += `<div class="debug-row"><span class="debug-label">Scale</span><span class="debug-value">${transform.scaleX.toFixed(2)}x</span></div>`;
        html += `<div class="debug-row"><span class="debug-label">Rotation</span><span class="debug-value">${transform.rotation.toFixed(1)}°</span></div>`;

        // Tracks
        if (Object.keys(tracks).length > 0) {
            html += '<div class="debug-section"><div class="debug-section-title">Keyframes</div>';
            for (const [prop, track] of Object.entries(tracks)) {
                html += `<div class="debug-row"><span class="debug-label">${prop}</span><span class="debug-value">${track.keyframes.length} kf</span></div>`;
            }
            html += '</div>';
        }

        // Effects
        if (effects.length > 0) {
            html += '<div class="debug-section"><div class="debug-section-title">Effects</div>';
            for (const effect of effects) {
                html += `<div class="debug-effect"><div class="debug-effect-name">${Utils.escapeHtml(effect.name)}</div>`;
                if (effect.params && effect.params.length > 0) {
                    for (const param of effect.params) {
                        html += `<div class="debug-row"><span class="debug-label">${param.label}</span><span class="debug-value">${param.value}</span></div>`;
                    }
                }
                html += '</div>';
            }
            html += '</div>';
        }

        // Shape data
        if (layer.shapeData) {
            html += '<div class="debug-section"><div class="debug-section-title">Shape</div>';
            html += `<div class="debug-row"><span class="debug-label">Type</span><span class="debug-value">${layer.shapeData.shapeType}</span></div>`;
            html += `<div class="debug-row"><span class="debug-label">Fill</span><span class="debug-value">${layer.shapeData.fill}</span></div>`;
            html += `<div class="debug-row"><span class="debug-label">Size</span><span class="debug-value">${layer.shapeData.width} x ${layer.shapeData.height}</span></div>`;
            html += '</div>';
        }

        // Text data
        if (layer.textData) {
            html += '<div class="debug-section"><div class="debug-section-title">Text</div>';
            html += `<div class="debug-row"><span class="debug-label">Content</span><span class="debug-value">${Utils.escapeHtml(layer.textData.text)}</span></div>`;
            html += `<div class="debug-row"><span class="debug-label">Font</span><span class="debug-value">${layer.textData.fontFamily} ${layer.textData.fontSize}px</span></div>`;
            html += `<div class="debug-row"><span class="debug-label">Color</span><span class="debug-value">${layer.textData.color}</span></div>`;
            html += '</div>';
        }

        debugContent.innerHTML = html;
    },

    inspectLayerAt(x, y) {
        if (!this.project) return;

        const debugPanel = document.getElementById('debugPanel');
        const debugContent = document.getElementById('debugContent');
        if (!debugPanel || !debugContent) return;

        // Find layer at position (reverse order for top-most layer)
        const layers = [...this.project.layers].reverse();
        let foundLayer = null;

        for (const layer of layers) {
            if (!layer.visible) continue;
            const transform = Renderer.getAnimatedTransform(layer, this.currentTime);
            const w = Renderer.getLayerWidth(layer);
            const h = Renderer.getLayerHeight(layer);

            // Simple bounding box check
            const cx = transform.x + Renderer.width / 2;
            const cy = transform.y + Renderer.height / 2;
            const scaleX = transform.scaleX;
            const scaleY = transform.scaleY;

            if (x >= cx - (w * scaleX) / 2 && x <= cx + (w * scaleX) / 2 &&
                y >= cy - (h * scaleY) / 2 && y <= cy + (h * scaleY) / 2) {
                foundLayer = layer;
                break;
            }
        }

        if (foundLayer) {
            this.showDebugInfo(foundLayer);
            debugPanel.hidden = false;
        } else {
            debugContent.innerHTML = '<div class="debug-empty">Tidak ada layer di posisi ini</div>';
            debugPanel.hidden = false;
        }
    },

    showDebugInfo(layer) {
        const debugContent = document.getElementById('debugContent');
        if (!debugContent) return;

        const transform = Renderer.getAnimatedTransform(layer, this.currentTime);
        const tracks = layer.tracks || {};
        const effects = layer.effects || [];

        let html = `
            <div class="debug-layer-name">${Utils.escapeHtml(layer.name)}</div>
            <div class="debug-row"><span class="debug-label">Type</span><span class="debug-value">${layer.type}</span></div>
            <div class="debug-row"><span class="debug-label">Visible</span><span class="debug-value">${layer.visible ? 'Yes' : 'No'}</span></div>
            <div class="debug-row"><span class="debug-label">Opacity</span><span class="debug-value">${(transform.opacity * 100).toFixed(0)}%</span></div>
            <div class="debug-row"><span class="debug-label">Position</span><span class="debug-value">${transform.x.toFixed(1)}, ${transform.y.toFixed(1)}</span></div>
            <div class="debug-row"><span class="debug-label">Scale</span><span class="debug-value">${transform.scaleX.toFixed(2)}x, ${transform.scaleY.toFixed(2)}x</span></div>
            <div class="debug-row"><span class="debug-label">Rotation</span><span class="debug-value">${transform.rotation.toFixed(1)}°</span></div>
        `;

        // Tracks
        if (Object.keys(tracks).length > 0) {
            html += '<div class="debug-section"><div class="debug-section-title">Keyframes</div>';
            for (const [prop, track] of Object.entries(tracks)) {
                html += `<div class="debug-row"><span class="debug-label">${prop}</span><span class="debug-value">${track.keyframes.length} kf</span></div>`;
            }
            html += '</div>';
        }

        // Effects
        if (effects.length > 0) {
            html += '<div class="debug-section"><div class="debug-section-title">Effects</div>';
            for (const effect of effects) {
                html += `<div class="debug-effect"><div class="debug-effect-name">${Utils.escapeHtml(effect.name)}</div>`;
                if (effect.params && effect.params.length > 0) {
                    for (const param of effect.params) {
                        html += `<div class="debug-effect-param">${param.label}: ${param.value}</div>`;
                    }
                }
                html += '</div>';
            }
            html += '</div>';
        }

        // Shape data
        if (layer.shapeData) {
            html += '<div class="debug-section"><div class="debug-section-title">Shape</div>';
            html += `<div class="debug-row"><span class="debug-label">Type</span><span class="debug-value">${layer.shapeData.shapeType}</span></div>`;
            html += `<div class="debug-row"><span class="debug-label">Fill</span><span class="debug-value">${layer.shapeData.fill}</span></div>`;
            html += `<div class="debug-row"><span class="debug-label">Size</span><span class="debug-value">${layer.shapeData.width} x ${layer.shapeData.height}</span></div>`;
            html += '</div>';
        }

        // Text data
        if (layer.textData) {
            html += '<div class="debug-section"><div class="debug-section-title">Text</div>';
            html += `<div class="debug-row"><span class="debug-label">Content</span><span class="debug-value">${Utils.escapeHtml(layer.textData.text)}</span></div>`;
            html += `<div class="debug-row"><span class="debug-label">Font</span><span class="debug-value">${layer.textData.fontFamily} ${layer.textData.fontSize}px</span></div>`;
            html += `<div class="debug-row"><span class="debug-label">Color</span><span class="debug-value">${layer.textData.color}</span></div>`;
            html += '</div>';
        }

        debugContent.innerHTML = html;
    },

    handleDrop(dataTransfer) {
        const files = Array.from(dataTransfer.files);
        for (const file of files) {
            if (Utils.isImageFile(file.name) || Utils.isVideoFile(file.name)) {
                // Add to media gallery
                Panels.addMediaToGallery(file);
            } else if (file.name.endsWith('.xml')) {
                // Load as preset
                Panels.loadXMLFile(file);
            }
        }
    },

    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    },

    play() {
        if (!this.project) return;
        this.isPlaying = true;
        this.lastFrameTime = performance.now();

        // Start audio
        AudioEngine.play(this.currentTime);

        // Update UI
        const btnPlay = document.getElementById('btnPlay');
        if (btnPlay) {
            btnPlay.innerHTML = '<svg class="i sm"><use href="#i-pause"/></svg><span>Jeda</span>';
        }

        const hint = document.getElementById('stageHint');
        if (hint) hint.parentElement.classList.add('hidden');

        if (this.onPlayStateChange) this.onPlayStateChange(true);
    },

    pause() {
        this.isPlaying = false;
        AudioEngine.pause();

        const btnPlay = document.getElementById('btnPlay');
        if (btnPlay) {
            btnPlay.innerHTML = '<svg class="i sm"><use href="#i-play"/></svg><span>Putar</span>';
        }

        const hint = document.getElementById('stageHint');
        if (hint) hint.parentElement.classList.remove('hidden');

        if (this.onPlayStateChange) this.onPlayStateChange(false);
    },

    seek(time) {
        this.currentTime = Utils.clamp(time, 0, this.duration);
        AudioEngine.seek(this.currentTime);
        this.updateTimecode();
        this.updateSeekBar();

        if (this.onTimeUpdate) this.onTimeUpdate(this.currentTime);
    },

    startRenderLoop() {
        const loop = (timestamp) => {
            if (this.isPlaying && this.project) {
                const delta = (timestamp - this.lastFrameTime) / 1000;
                this.lastFrameTime = timestamp;
                this.currentTime += delta;

                if (this.currentTime >= this.duration) {
                    if (this.loop) {
                        this.currentTime = 0;
                        AudioEngine.seek(0);
                    } else {
                        this.currentTime = this.duration;
                        this.pause();
                    }
                }

                this.updateTimecode();
                this.updateSeekBar();

                if (this.onTimeUpdate) this.onTimeUpdate(this.currentTime);
            }

            // Render
            if (this.project) {
                Renderer.render(this.project, this.currentTime);
            }

            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
    },

    updateTimecode() {
        const el = document.getElementById('timecode');
        if (el) {
            el.textContent = Utils.formatTimecode(this.currentTime, this.fps);
        }
    },

    updateSeekBar() {
        const seekBar = document.getElementById('seekBar');
        if (seekBar) {
            const pct = (this.currentTime / this.duration) * 1000;
            seekBar.value = Math.round(pct);
            seekBar.style.setProperty('--fill', (pct / 10) + '%');
        }
    },

    getCurrentTime() {
        return this.currentTime;
    },

    getDuration() {
        return this.duration;
    }
};
