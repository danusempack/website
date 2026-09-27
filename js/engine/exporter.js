/* ─── Video Exporter ─────────────────────────────────────────────────────────
   Client-side video export using MediaRecorder API
   ═══════════════════════════════════════════════════════════════════════════ */

const Exporter = {
    isExporting: false,
    progress: 0,
    mediaRecorder: null,
    recordedChunks: [],
    onProgress: null,
    onComplete: null,
    onError: null,

    async export(project, options = {}) {
        if (this.isExporting) {
            throw new Error('Export already in progress');
        }

        const {
            resolution = 360,
            fps = 30,
            quality = 'medium',
            format = 'webm'
        } = options;

        this.isExporting = true;
        this.progress = 0;
        this.recordedChunks = [];

        try {
            const canvas = document.getElementById('viewport');
            if (!canvas) throw new Error('Canvas not found');

            // Set export resolution
            const aspectRatio = project.width / project.height;
            let exportWidth, exportHeight;

            if (aspectRatio > 1) {
                exportHeight = resolution;
                exportWidth = Math.round(resolution * aspectRatio);
            } else {
                exportWidth = resolution;
                exportHeight = Math.round(resolution / aspectRatio);
            }

            // Create offscreen canvas for export
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = exportWidth;
            exportCanvas.height = exportHeight;
            const exportCtx = exportCanvas.getContext('2d');

            // Capture stream
            const stream = exportCanvas.captureStream(fps);

            // Add audio if available
            if (AudioEngine.audioBuffer && AudioEngine.ctx) {
                const dest = AudioEngine.ctx.createMediaStreamDestination();
                AudioEngine.gainNode.connect(dest);
                dest.stream.getAudioTracks().forEach(track => {
                    stream.addTrack(track);
                });
            }

            // Setup recorder
            const mimeType = this.getMimeType(format);
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                throw new Error(`Format ${format} not supported`);
            }

            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: this.getBitrate(quality, resolution)
            });

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.recordedChunks.push(e.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.recordedChunks, { type: mimeType });
                this.isExporting = false;

                if (this.onComplete) {
                    this.onComplete({
                        blob,
                        url: URL.createObjectURL(blob),
                        size: blob.size,
                        duration: project.duration
                    });
                }
            };

            this.mediaRecorder.onerror = (e) => {
                this.isExporting = false;
                if (this.onError) {
                    this.onError(e);
                }
            };

            // Start recording
            this.mediaRecorder.start(100);

            // Render frames
            await this.renderFrames(project, exportCtx, exportWidth, exportHeight, fps);

            // Stop recording
            this.mediaRecorder.stop();

            return new Promise((resolve, reject) => {
                this.onComplete = (result) => {
                    this.onComplete = null;
                    resolve(result);
                };
                this.onError = (error) => {
                    this.onError = null;
                    reject(error);
                };
            });

        } catch (error) {
            this.isExporting = false;
            throw error;
        }
    },

    async renderFrames(project, ctx, width, height, fps) {
        const totalFrames = Math.ceil(project.duration * fps);
        const frameDuration = 1 / fps;

        // Store original renderer state
        const origCanvas = Renderer.canvas;
        const origCtx = Renderer.ctx;
        const origWidth = Renderer.width;
        const origHeight = Renderer.height;

        // Switch to export renderer
        Renderer.canvas = { width, height, style: {} };
        Renderer.ctx = ctx;
        Renderer.width = width;
        Renderer.height = height;

        // Start audio
        if (AudioEngine.audioBuffer) {
            AudioEngine.play(0);
        }

        const startTime = performance.now();

        for (let i = 0; i < totalFrames; i++) {
            const currentTime = i * frameDuration;

            // Render frame
            Renderer.render(project, currentTime);

            // Update progress
            this.progress = Math.round((i / totalFrames) * 100);
            if (this.onProgress) {
                this.onProgress(this.progress, i, totalFrames);
            }

            // Wait for next frame
            const targetTime = startTime + (i + 1) * (1000 / fps);
            const waitTime = targetTime - performance.now();
            if (waitTime > 0) {
                await new Promise(r => setTimeout(r, waitTime));
            }
        }

        // Stop audio
        AudioEngine.stop();

        // Restore original renderer state
        Renderer.canvas = origCanvas;
        Renderer.ctx = origCtx;
        Renderer.width = origWidth;
        Renderer.height = origHeight;
    },

    getMimeType(format) {
        const types = {
            'webm': 'video/webm;codecs=vp9',
            'mp4': 'video/mp4',
            'gif': 'image/gif'
        };
        return types[format] || 'video/webm';
    },

    getBitrate(quality, resolution) {
        const baseBitrates = {
            'low': 1000000,
            'medium': 2500000,
            'high': 5000000,
            'ultra': 8000000
        };
        const base = baseBitrates[quality] || baseBitrates.medium;
        // Scale by resolution
        const scale = (resolution / 360) * (resolution / 360);
        return Math.round(base * scale);
    },

    cancel() {
        if (this.mediaRecorder && this.isExporting) {
            this.mediaRecorder.stop();
            this.isExporting = false;
        }
    },

    getProgress() {
        return this.progress;
    }
};
