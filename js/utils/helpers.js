/* ─── Utility Helpers ─────────────────────────────────────────────────────── */

const Utils = {
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    },

    clamp(val, min, max) {
        return Math.min(Math.max(val, min), max);
    },

    lerp(a, b, t) {
        return a + (b - a) * t;
    },

    inverseLerp(a, b, val) {
        return (val - a) / (b - a);
    },

    mapRange(val, inMin, inMax, outMin, outMax) {
        return this.lerp(outMin, outMax, this.inverseLerp(inMin, inMax, val));
    },

    formatTimecode(seconds, fps = 30) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const f = Math.floor((seconds % 1) * fps);
        return `${this.pad(h)}:${this.pad(m)}:${this.pad(s)}:${this.pad(f)}`;
    },

    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${this.pad(m)}:${this.pad(s)}.${this.pad(ms)}`;
    },

    pad(n) {
        return n.toString().padStart(2, '0');
    },

    debounce(fn, ms) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    },

    throttle(fn, ms) {
        let last = 0;
        return (...args) => {
            const now = Date.now();
            if (now - last >= ms) {
                last = now;
                fn(...args);
            }
        };
    },

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    },

    extractFileExtension(filename) {
        return filename.split('.').pop()?.toLowerCase() || '';
    },

    isVideoFile(filename) {
        return ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(this.extractFileExtension(filename));
    },

    isAudioFile(filename) {
        return ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a'].includes(this.extractFileExtension(filename));
    },

    isImageFile(filename) {
        return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(this.extractFileExtension(filename));
    },

    getAspectRatioDimensions(ratio) {
        const base = 1080;
        switch (ratio) {
            case '9:16': return { width: base, height: Math.round(base * 16 / 9) };
            case '16:9': return { width: Math.round(base * 16 / 9), height: base };
            case '1:1': return { width: base, height: base };
            case '4:5': return { width: base, height: Math.round(base * 5 / 4) };
            default: return { width: base, height: base };
        }
    },

    hexToRgba(hex, alpha = 1) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    sanitizeUrl(url) {
        try {
            const parsed = new URL(url);
            return ['http:', 'https:'].includes(parsed.protocol) ? url : null;
        } catch {
            return null;
        }
    },

    extractGoogleDriveId(url) {
        const patterns = [
            /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
            /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
            /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/,
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    },

    extractAlightShareId(url) {
        const match = url.match(/alightcreative\.com\/am\/share\/([a-zA-Z0-9]+)/);
        return match ? match[1] : null;
    },

    cubicBezier(t, p0, p1, p2, p3) {
        const u = 1 - t;
        const tt = t * t;
        const uu = u * u;
        const uuu = uu * u;
        const ttt = tt * t;
        return uuu * p0 + 3 * uu * t * p1 + 3 * u * tt * p2 + ttt * p3;
    },

    solveBezierX(x, x1, x2, epsilon = 1e-6) {
        let t = x;
        for (let i = 0; i < 8; i++) {
            const currentX = this.cubicBezier(t, 0, x1, x2, 1);
            const slope = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
            if (Math.abs(currentX - x) < epsilon) return t;
            if (Math.abs(slope) < epsilon) break;
            t = this.clamp(t - (currentX - x) / slope, 0, 1);
        }
        return t;
    },

    evaluateEasing(t, easing, bezier) {
        switch (easing) {
            case 'linear': return t;
            case 'easeIn': return t * t * t;
            case 'easeOut': return 1 - Math.pow(1 - t, 3);
            case 'easeInOut': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            case 'spring': {
                const c4 = (2 * Math.PI) / 3;
                return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
            }
            case 'bezier': {
                if (!bezier) return t;
                const solvedT = this.solveBezierX(t, bezier.x1, bezier.x2);
                return this.cubicBezier(solvedT, 0, bezier.y1, bezier.y2, 1);
            }
            default: return t;
        }
    },

    sampleKeyframes(keyframes, time) {
        if (!keyframes || keyframes.length === 0) return null;
        if (keyframes.length === 1) return keyframes[0].value;

        let prev = keyframes[0];
        let next = keyframes[keyframes.length - 1];

        for (let i = 0; i < keyframes.length - 1; i++) {
            if (time >= keyframes[i].time && time <= keyframes[i + 1].time) {
                prev = keyframes[i];
                next = keyframes[i + 1];
                break;
            }
        }

        if (time <= keyframes[0].time) return keyframes[0].value;
        if (time >= keyframes[keyframes.length - 1].time) return keyframes[keyframes.length - 1].value;

        const rawT = (time - prev.time) / (next.time - prev.time);
        const easedT = this.evaluateEasing(rawT, next.easing, next.bezier);
        return this.lerp(prev.value, next.value, easedT);
    }
};
