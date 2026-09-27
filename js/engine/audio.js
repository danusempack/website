/* ─── Audio Engine ───────────────────────────────────────────────────────────
   Web Audio API based audio playback and synchronization
   ═══════════════════════════════════════════════════════════════════════════ */

const AudioEngine = {
    ctx: null,
    gainNode: null,
    sourceNode: null,
    audioBuffer: null,
    isPlaying: false,
    startTime: 0,
    pauseTime: 0,
    playbackRate: 1,
    volume: 1,
    duration: 0,

    init() {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.gainNode = this.ctx.createGain();
        this.gainNode.connect(this.ctx.destination);
        this.gainNode.gain.value = this.volume;
    },

    async load(url) {
        this.init();
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            this.audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
            this.duration = this.audioBuffer.duration;
            return true;
        } catch (e) {
            console.error('Audio load failed:', e);
            return false;
        }
    },

    play(offset = 0) {
        if (!this.audioBuffer) return;
        this.init();

        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        this.stop();

        this.sourceNode = this.ctx.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.playbackRate.value = this.playbackRate;
        this.sourceNode.connect(this.gainNode);

        const clampedOffset = Utils.clamp(offset, 0, this.duration);
        this.sourceNode.start(0, clampedOffset);
        this.startTime = this.ctx.currentTime - clampedOffset;
        this.isPlaying = true;

        this.sourceNode.onended = () => {
            if (this.isPlaying) {
                this.isPlaying = false;
                this.pauseTime = 0;
            }
        };
    },

    pause() {
        if (!this.isPlaying) return;
        this.pauseTime = this.getCurrentTime();
        this.stop();
    },

    stop() {
        if (this.sourceNode) {
            this.isPlaying = false;
            try {
                this.sourceNode.stop();
                this.sourceNode.disconnect();
            } catch (e) {}
            this.sourceNode = null;
        }
    },

    seek(time) {
        const wasPlaying = this.isPlaying;
        if (wasPlaying) {
            this.stop();
            this.play(time);
        } else {
            this.pauseTime = time;
        }
    },

    getCurrentTime() {
        if (this.isPlaying && this.ctx) {
            return (this.ctx.currentTime - this.startTime) * this.playbackRate;
        }
        return this.pauseTime;
    },

    setPlaybackRate(rate) {
        this.playbackRate = rate;
        if (this.sourceNode) {
            this.sourceNode.playbackRate.value = rate;
        }
    },

    setVolume(vol) {
        this.volume = vol;
        if (this.gainNode) {
            this.gainNode.gain.value = vol;
        }
    },

    getDuration() {
        return this.duration;
    },

    isAudioPlaying() {
        return this.isPlaying;
    }
};
