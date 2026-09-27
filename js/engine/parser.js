/* ─── XML Preset Parser ─────────────────────────────────────────────────────
   Parses Alight Motion XML preset format into internal layer structure
   ═══════════════════════════════════════════════════════════════════════════ */

const PresetParser = {
    parse(xmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, 'text/xml');

        if (doc.querySelector('parsererror')) {
            throw new Error('XML parsing failed — invalid format');
        }

        const root = doc.documentElement;
        const project = {
            name: root.getAttribute('name') || 'Imported Project',
            aspectRatio: root.getAttribute('aspectRatio') || '9:16',
            fps: parseInt(root.getAttribute('fps')) || 30,
            duration: parseFloat(root.getAttribute('duration')) || 5,
            width: parseInt(root.getAttribute('width')) || 540,
            height: parseInt(root.getAttribute('height')) || 960,
            backgroundColor: root.getAttribute('backgroundColor') || '#000000',
            layers: [],
            mediaSlots: []
        };

        // Parse media slots first
        const slotNodes = root.querySelectorAll('mediaSlot, slot, media');
        slotNodes.forEach((node, index) => {
            project.mediaSlots.push({
                id: node.getAttribute('id') || `slot_${index}`,
                name: node.getAttribute('name') || `Slot ${index + 1}`,
                type: node.getAttribute('type') || 'image',
                src: node.getAttribute('src') || '',
                thumbnail: node.getAttribute('thumbnail') || ''
            });
        });

        // Parse layers
        const layerNodes = root.querySelectorAll('layer, element');
        layerNodes.forEach(node => {
            const layer = this.parseLayer(node);
            if (layer) project.layers.push(layer);
        });

        // If no layers found, try scene-based parsing
        if (project.layers.length === 0) {
            const sceneNodes = root.querySelectorAll('scene');
            sceneNodes.forEach(scene => {
                const sceneLayers = this.parseScene(scene);
                project.layers.push(...sceneLayers);
            });
        }

        return project;
    },

    parseLayer(node) {
        const type = (node.getAttribute('type') || 'shape').toLowerCase();
        const layer = {
            id: Utils.generateId(),
            type: this.mapLayerType(type),
            name: node.getAttribute('name') || 'Layer',
            visible: node.getAttribute('visible') !== 'false',
            locked: node.getAttribute('locked') === 'true',
            blendMode: node.getAttribute('blendMode') || 'normal',
            opacity: parseFloat(node.getAttribute('opacity')) || 1,
            transform: this.parseTransform(node),
            tracks: {},
            effects: [],
            startTime: parseFloat(node.getAttribute('startTime')) || 0,
            duration: parseFloat(node.getAttribute('duration')) || 5
        };

        // Parse transform keyframes
        const transformNode = node.querySelector('transform, animation');
        if (transformNode) {
            layer.tracks = this.parseTracks(transformNode);
        }

        // Parse shape data
        const shapeNode = node.querySelector('shape');
        if (shapeNode) {
            layer.shapeData = this.parseShape(shapeNode);
        }

        // Parse text data
        const textNode = node.querySelector('text');
        if (textNode) {
            layer.textData = this.parseText(textNode);
        }

        // Parse media reference
        const mediaNode = node.querySelector('media, image, video');
        if (mediaNode) {
            layer.mediaData = {
                src: mediaNode.getAttribute('src') || '',
                mediaType: mediaNode.getAttribute('mediaType') || (type === 'video' ? 'video' : 'image'),
                slotRef: mediaNode.getAttribute('slotRef') || null,
                loop: mediaNode.getAttribute('loop') !== 'false',
                volume: parseFloat(mediaNode.getAttribute('volume')) || 1,
                playbackRate: parseFloat(mediaNode.getAttribute('playbackRate')) || 1
            };
        }

        // Parse effects
        const effectsNode = node.querySelector('effects');
        if (effectsNode) {
            layer.effects = this.parseEffects(effectsNode);
        }

        return layer;
    },

    parseScene(sceneNode) {
        const layers = [];
        const children = sceneNode.querySelectorAll('layer, element, shape, text, image, video');
        children.forEach(child => {
            const layer = this.parseLayer(child);
            if (layer) layers.push(layer);
        });
        return layers;
    },

    parseTransform(node) {
        return {
            x: parseFloat(node.getAttribute('x')) || 0,
            y: parseFloat(node.getAttribute('y')) || 0,
            scaleX: parseFloat(node.getAttribute('scaleX')) || 1,
            scaleY: parseFloat(node.getAttribute('scaleY')) || 1,
            rotation: parseFloat(node.getAttribute('rotation')) || 0,
            opacity: parseFloat(node.getAttribute('opacity')) || 1,
            anchorX: parseFloat(node.getAttribute('anchorX')) || 0.5,
            anchorY: parseFloat(node.getAttribute('anchorY')) || 0.5
        };
    },

    parseTracks(node) {
        const tracks = {};
        const trackNodes = node.querySelectorAll('track, animation, property');
        trackNodes.forEach(trackNode => {
            const property = trackNode.getAttribute('property') || trackNode.getAttribute('name') || 'unknown';
            const keyframes = [];
            const kfNodes = trackNode.querySelectorAll('keyframe, kf, key');
            kfNodes.forEach(kf => {
                keyframes.push({
                    id: Utils.generateId(),
                    time: parseFloat(kf.getAttribute('time')) || 0,
                    value: parseFloat(kf.getAttribute('value')) || 0,
                    easing: kf.getAttribute('easing') || 'linear',
                    bezier: kf.getAttribute('bezier') ? this.parseBezier(kf.getAttribute('bezier')) : null
                });
            });
            if (keyframes.length > 0) {
                tracks[property] = { property, keyframes };
            }
        });
        return tracks;
    },

    parseBezier(str) {
        const parts = str.split(',').map(Number);
        if (parts.length === 4 && parts.every(n => !isNaN(n))) {
            return { x1: parts[0], y1: parts[1], x2: parts[2], y2: parts[3] };
        }
        return null;
    },

    parseShape(node) {
        return {
            shapeType: node.getAttribute('shapeType') || 'rectangle',
            fill: node.getAttribute('fill') || '#ffffff',
            fillEnabled: node.getAttribute('fillEnabled') !== 'false',
            stroke: node.getAttribute('stroke') || '#000000',
            strokeWidth: parseFloat(node.getAttribute('strokeWidth')) || 0,
            strokeEnabled: node.getAttribute('strokeEnabled') === 'true',
            width: parseFloat(node.getAttribute('width')) || 100,
            height: parseFloat(node.getAttribute('height')) || 100,
            sides: parseInt(node.getAttribute('sides')) || 3,
            points: parseInt(node.getAttribute('points')) || 5
        };
    },

    parseText(node) {
        return {
            text: node.getAttribute('text') || node.textContent || 'Text',
            fontFamily: node.getAttribute('fontFamily') || 'Inter',
            fontSize: parseFloat(node.getAttribute('fontSize')) || 48,
            fontWeight: parseInt(node.getAttribute('fontWeight')) || 400,
            fontStyle: node.getAttribute('fontStyle') || 'normal',
            textAlign: node.getAttribute('textAlign') || 'center',
            color: node.getAttribute('color') || '#ffffff',
            lineHeight: parseFloat(node.getAttribute('lineHeight')) || 1.2,
            letterSpacing: parseFloat(node.getAttribute('letterSpacing')) || 0,
            strokeColor: node.getAttribute('strokeColor') || '#000000',
            strokeWidth: parseFloat(node.getAttribute('strokeWidth')) || 0,
            strokeEnabled: node.getAttribute('strokeEnabled') === 'true',
            backgroundColor: node.getAttribute('backgroundColor') || '#000000',
            backgroundEnabled: node.getAttribute('backgroundEnabled') === 'true',
            width: parseFloat(node.getAttribute('width')) || 300,
            height: parseFloat(node.getAttribute('height')) || 100
        };
    },

    parseEffects(node) {
        const effects = [];
        const effectNodes = node.querySelectorAll('effect, fx');
        effectNodes.forEach(effNode => {
            const params = [];
            const paramNodes = effNode.querySelectorAll('param, parameter');
            paramNodes.forEach(p => {
                params.push({
                    key: p.getAttribute('key') || p.getAttribute('name') || '',
                    label: p.getAttribute('label') || p.getAttribute('name') || '',
                    type: p.getAttribute('type') || 'number',
                    value: p.getAttribute('value') || '0',
                    min: parseFloat(p.getAttribute('min')) || 0,
                    max: parseFloat(p.getAttribute('max')) || 100,
                    step: parseFloat(p.getAttribute('step')) || 1
                });
            });
            effects.push({
                id: Utils.generateId(),
                type: effNode.getAttribute('type') || 'unknown',
                name: effNode.getAttribute('name') || 'Effect',
                enabled: effNode.getAttribute('enabled') !== 'false',
                params,
                paramTracks: {}
            });
        });
        return effects;
    },

    mapLayerType(type) {
        const map = {
            'shape': 'shape',
            'rectangle': 'shape',
            'ellipse': 'shape',
            'text': 'text',
            'media': 'media',
            'image': 'media',
            'video': 'media',
            'audio': 'audio',
            'adjustment': 'adjustment'
        };
        return map[type] || 'shape';
    },

    // Generate a sample preset for demo purposes
    generateSamplePreset() {
        return {
            name: 'Sample Preset',
            aspectRatio: '9:16',
            fps: 30,
            duration: 5,
            width: 540,
            height: 960,
            backgroundColor: '#1a1a2e',
            layers: [
                {
                    id: Utils.generateId(),
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
                },
                {
                    id: Utils.generateId(),
                    type: 'shape',
                    name: 'Circle Accent',
                    visible: true,
                    locked: false,
                    blendMode: 'normal',
                    opacity: 0.8,
                    transform: { x: 0, y: -200, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.8, anchorX: 0.5, anchorY: 0.5 },
                    tracks: {
                        x: { property: 'x', keyframes: [
                            { id: Utils.generateId(), time: 0, value: 0, easing: 'easeInOut' },
                            { id: Utils.generateId(), time: 2.5, value: 100, easing: 'easeInOut' },
                            { id: Utils.generateId(), time: 5, value: 0, easing: 'easeInOut' }
                        ]},
                        y: { property: 'y', keyframes: [
                            { id: Utils.generateId(), time: 0, value: -200, easing: 'easeInOut' },
                            { id: Utils.generateId(), time: 2.5, value: 0, easing: 'easeInOut' },
                            { id: Utils.generateId(), time: 5, value: -200, easing: 'easeInOut' }
                        ]}
                    },
                    effects: [],
                    startTime: 0,
                    duration: 5,
                    shapeData: {
                        shapeType: 'ellipse',
                        fill: '#6366f1',
                        fillEnabled: true,
                        stroke: '#000000',
                        strokeWidth: 0,
                        strokeEnabled: false,
                        width: 200,
                        height: 200
                    }
                },
                {
                    id: Utils.generateId(),
                    type: 'text',
                    name: 'Title Text',
                    visible: true,
                    locked: false,
                    blendMode: 'normal',
                    opacity: 1,
                    transform: { x: 0, y: 200, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
                    tracks: {
                        opacity: { property: 'opacity', keyframes: [
                            { id: Utils.generateId(), time: 0, value: 0, easing: 'easeOut' },
                            { id: Utils.generateId(), time: 0.5, value: 1, easing: 'linear' },
                            { id: Utils.generateId(), time: 4.5, value: 1, easing: 'linear' },
                            { id: Utils.generateId(), time: 5, value: 0, easing: 'easeIn' }
                        ]}
                    },
                    effects: [],
                    startTime: 0,
                    duration: 5,
                    textData: {
                        text: 'MotionForge',
                        fontFamily: 'Inter',
                        fontSize: 72,
                        fontWeight: 700,
                        fontStyle: 'normal',
                        textAlign: 'center',
                        color: '#ffffff',
                        lineHeight: 1.2,
                        letterSpacing: 0,
                        strokeColor: '#000000',
                        strokeWidth: 0,
                        strokeEnabled: false,
                        backgroundColor: '#000000',
                        backgroundEnabled: false,
                        width: 500,
                        height: 100
                    }
                }
            ],
            mediaSlots: []
        };
    }
};
