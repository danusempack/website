/* ─── Canvas Renderer ───────────────────────────────────────────────────────
   Renders layers to canvas with transform, effects, and animation
   ═══════════════════════════════════════════════════════════════════════════ */

const Renderer = {
    canvas: null,
    ctx: null,
    width: 540,
    height: 960,
    dpr: 1,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;
        this.resize();
    },

    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const displayWidth = rect.width;
        const displayHeight = rect.height;

        this.canvas.width = displayWidth * this.dpr;
        this.canvas.height = displayHeight * this.dpr;

        this.width = displayWidth;
        this.height = displayHeight;

        this.ctx.scale(this.dpr, this.dpr);
    },

    setDimensions(width, height) {
        this.width = width;
        this.height = height;
        if (this.canvas) {
            this.canvas.width = width * this.dpr;
            this.canvas.height = height * this.dpr;
            this.canvas.style.width = width + 'px';
            this.canvas.style.height = height + 'px';
            this.ctx.scale(this.dpr, this.dpr);
        }
    },

    clear(bgColor = '#000000') {
        if (!this.ctx) return;
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.fillStyle = bgColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    },

    render(project, currentTime) {
        if (!this.ctx || !project) return;

        this.clear(project.backgroundColor);

        const sortedLayers = [...project.layers].sort((a, b) => {
            const aIndex = project.layers.indexOf(a);
            const bIndex = project.layers.indexOf(b);
            return aIndex - bIndex;
        });

        for (const layer of sortedLayers) {
            if (!layer.visible) continue;
            if (currentTime < layer.startTime || currentTime > layer.startTime + layer.duration) continue;

            this.renderLayer(layer, currentTime - layer.startTime);
        }
    },

    renderLayer(layer, localTime) {
        const ctx = this.ctx;
        ctx.save();

        // Get animated transform
        const transform = this.getAnimatedTransform(layer, localTime);

        // Apply opacity
        const opacityTrack = layer.tracks.opacity;
        let opacity = transform.opacity;
        if (opacityTrack) {
            const sampled = Utils.sampleKeyframes(opacityTrack.keyframes, localTime);
            if (sampled !== null) opacity = sampled;
        }
        ctx.globalAlpha = Utils.clamp(opacity * layer.opacity, 0, 1);

        // Apply blend mode
        if (layer.blendMode && layer.blendMode !== 'normal') {
            ctx.globalCompositeOperation = layer.blendMode;
        }

        // Calculate anchor point
        const anchorX = transform.anchorX;
        const anchorY = transform.anchorY;

        // Apply transform
        ctx.translate(transform.x + this.width / 2, transform.y + this.height / 2);
        ctx.rotate((transform.rotation * Math.PI) / 180);
        ctx.scale(transform.scaleX, transform.scaleY);
        ctx.translate(-anchorX * this.getLayerWidth(layer), -anchorY * this.getLayerHeight(layer));

        // Render based on type
        switch (layer.type) {
            case 'shape':
                this.renderShape(layer);
                break;
            case 'text':
                this.renderText(layer);
                break;
            case 'media':
                this.renderMedia(layer);
                break;
        }

        // Apply effects
        if (layer.effects && layer.effects.length > 0) {
            this.applyEffects(layer.effects, layer, localTime);
        }

        ctx.restore();
    },

    getAnimatedTransform(layer, time) {
        const base = { ...layer.transform };
        const tracks = layer.tracks;

        if (tracks.x) {
            const val = Utils.sampleKeyframes(tracks.x.keyframes, time);
            if (val !== null) base.x = val;
        }
        if (tracks.y) {
            const val = Utils.sampleKeyframes(tracks.y.keyframes, time);
            if (val !== null) base.y = val;
        }
        if (tracks.scaleX) {
            const val = Utils.sampleKeyframes(tracks.scaleX.keyframes, time);
            if (val !== null) base.scaleX = val;
        }
        if (tracks.scaleY) {
            const val = Utils.sampleKeyframes(tracks.scaleY.keyframes, time);
            if (val !== null) base.scaleY = val;
        }
        if (tracks.rotation) {
            const val = Utils.sampleKeyframes(tracks.rotation.keyframes, time);
            if (val !== null) base.rotation = val;
        }
        if (tracks.opacity) {
            const val = Utils.sampleKeyframes(tracks.opacity.keyframes, time);
            if (val !== null) base.opacity = val;
        }

        return base;
    },

    getLayerWidth(layer) {
        if (layer.shapeData) return layer.shapeData.width;
        if (layer.textData) return layer.textData.width;
        if (layer.mediaData) return layer.mediaData.width || 200;
        return 100;
    },

    getLayerHeight(layer) {
        if (layer.shapeData) return layer.shapeData.height;
        if (layer.textData) return layer.textData.height;
        if (layer.mediaData) return layer.mediaData.height || 200;
        return 100;
    },

    renderShape(layer) {
        const ctx = this.ctx;
        const data = layer.shapeData;
        if (!data) return;

        const w = data.width;
        const h = data.height;

        ctx.beginPath();

        switch (data.shapeType) {
            case 'rectangle':
                ctx.rect(-w / 2, -h / 2, w, h);
                break;
            case 'ellipse':
                ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
                break;
            case 'triangle':
                ctx.moveTo(0, -h / 2);
                ctx.lineTo(w / 2, h / 2);
                ctx.lineTo(-w / 2, h / 2);
                ctx.closePath();
                break;
            case 'star':
                this.drawStar(0, 0, data.points || 5, w / 2, w / 4);
                break;
            case 'polygon':
                this.drawPolygon(0, 0, data.sides || 6, w / 2);
                break;
            default:
                ctx.rect(-w / 2, -h / 2, w, h);
        }

        if (data.fillEnabled && data.fill) {
            ctx.fillStyle = data.fill;
            ctx.fill();
        }

        if (data.strokeEnabled && data.strokeWidth > 0) {
            ctx.strokeStyle = data.stroke;
            ctx.lineWidth = data.strokeWidth;
            ctx.stroke();
        }
    },

    drawStar(cx, cy, spikes, outerRadius, innerRadius) {
        const ctx = this.ctx;
        let rot = Math.PI / 2 * 3;
        const step = Math.PI / spikes;

        ctx.beginPath();
        ctx.moveTo(cx, cy - outerRadius);

        for (let i = 0; i < spikes; i++) {
            ctx.lineTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius);
            rot += step;
            ctx.lineTo(cx + Math.cos(rot) * innerRadius, cy + Math.sin(rot) * innerRadius);
            rot += step;
        }

        ctx.lineTo(cx, cy - outerRadius);
        ctx.closePath();
    },

    drawPolygon(cx, cy, sides, radius) {
        const ctx = this.ctx;
        const angleStep = (Math.PI * 2) / sides;
        const startAngle = -Math.PI / 2;

        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const angle = startAngle + i * angleStep;
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
    },

    renderText(layer) {
        const ctx = this.ctx;
        const data = layer.textData;
        if (!data) return;

        ctx.font = `${data.fontStyle} ${data.fontWeight} ${data.fontSize}px "${data.fontFamily}", sans-serif`;
        ctx.textAlign = data.textAlign;
        ctx.textBaseline = 'middle';

        const lines = data.text.split('\n');
        const lineHeight = data.fontSize * data.lineHeight;
        const totalHeight = lines.length * lineHeight;
        const startY = -totalHeight / 2 + lineHeight / 2;

        // Background
        if (data.backgroundEnabled) {
            ctx.fillStyle = data.backgroundColor;
            const metrics = ctx.measureText(data.text);
            const bgWidth = metrics.width + 20;
            const bgHeight = totalHeight + 10;
            ctx.fillRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight);
        }

        // Stroke
        if (data.strokeEnabled && data.strokeWidth > 0) {
            ctx.strokeStyle = data.strokeColor;
            ctx.lineWidth = data.strokeWidth;
            ctx.lineJoin = 'round';
            lines.forEach((line, i) => {
                const y = startY + i * lineHeight;
                ctx.strokeText(line, 0, y);
            });
        }

        // Fill
        ctx.fillStyle = data.color;
        lines.forEach((line, i) => {
            const y = startY + i * lineHeight;
            ctx.fillText(line, 0, y);
        });
    },

    renderMedia(layer) {
        const ctx = this.ctx;
        const data = layer.mediaData;
        if (!data || !data.src) return;

        // Media rendering would use cached images/videos
        // For now, draw a placeholder
        const w = data.width || 200;
        const h = data.height || 200;

        ctx.fillStyle = '#333';
        ctx.fillRect(-w / 2, -h / 2, w, h);

        ctx.fillStyle = '#666';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Media', 0, 0);
    },

    applyEffects(effects, layer, time) {
        // Simplified effect application
        // In a full implementation, this would use WebGL shaders
        for (const effect of effects) {
            if (!effect.enabled) continue;

            switch (effect.type) {
                case 'blur':
                    // Apply blur via ctx.filter
                    const blurParam = effect.params.find(p => p.key === 'radius');
                    if (blurParam) {
                        this.ctx.filter = `blur(${blurParam.value}px)`;
                    }
                    break;
                case 'glow':
                    const glowParam = effect.params.find(p => p.key === 'intensity');
                    if (glowParam) {
                        this.ctx.shadowColor = layer.shapeData?.fill || '#fff';
                        this.ctx.shadowBlur = glowParam.value;
                    }
                    break;
            }
        }
    }
};
