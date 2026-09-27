// Vercel Serverless Function — Alight Creative Proxy
// Fetches preset data from Alight Creative share links without any paid API

const https = require('https');
const http = require('http');

function fetchUrl(url, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) {
            reject(new Error('Too many redirects'));
            return;
        }

        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                'Accept': 'text/html,application/json,*/*',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const newUrl = new URL(res.headers.location, url).toString();
                res.resume();
                resolve(fetchUrl(newUrl, redirectCount + 1));
                return;
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

function extractJsonFromHtml(html) {
    // Try to find JSON data in script tags
    const patterns = [
        /window\.__INITIAL_STATE__\s*=\s*({.+?});/s,
        /window\.__DATA__\s*=\s*({.+?});/s,
        /window\.data\s*=\s*({.+?});/s,
        /<script[^>]*id="__NEXT_DATA__"[^>]*>({.+?})<\/script>/s,
        /"project":\s*({.+?})\s*}/s,
        /"layers":\s*\[(.+?)\]/s,
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
            try {
                const jsonStr = match[1];
                const parsed = JSON.parse(jsonStr);
                if (parsed) return parsed;
            } catch (e) {
                // Try to fix common JSON issues
                try {
                    const fixed = jsonStr
                        .replace(/(\w+):/g, '"$1":')
                        .replace(/'/g, '"');
                    const parsed = JSON.parse(fixed);
                    if (parsed) return parsed;
                } catch (e2) {
                    continue;
                }
            }
        }
    }

    // Try to find any JSON-like structure
    const jsonMatches = html.match(/\{[^{}]*"layers"[^{}]*\}/g);
    if (jsonMatches) {
        for (const match of jsonMatches) {
            try {
                return JSON.parse(match);
            } catch (e) {
                continue;
            }
        }
    }

    return null;
}

function extractPresetFromData(data, url) {
    // Try to find preset data in various formats
    const result = {
        name: 'Alight Preset',
        aspectRatio: '9:16',
        fps: 30,
        duration: 5,
        width: 540,
        height: 960,
        backgroundColor: '#000000',
        layers: [],
        mediaSlots: [],
        source: url
    };

    // If data has project info
    if (data.project) {
        result.name = data.project.name || result.name;
        result.aspectRatio = data.project.aspectRatio || result.aspectRatio;
        result.fps = data.project.fps || result.fps;
        result.duration = data.project.duration || result.duration;
    }

    // If data has layers
    if (data.layers) {
        result.layers = data.layers.map(layer => ({
            id: layer.id || Math.random().toString(36).slice(2),
            type: layer.type || 'shape',
            name: layer.name || 'Layer',
            visible: layer.visible !== false,
            locked: layer.locked === true,
            blendMode: layer.blendMode || 'normal',
            opacity: layer.opacity || 1,
            transform: layer.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
            tracks: layer.tracks || {},
            effects: layer.effects || [],
            startTime: layer.startTime || 0,
            duration: layer.duration || result.duration,
            shapeData: layer.shapeData,
            textData: layer.textData,
            mediaData: layer.mediaData
        })).filter(l => l.type);
    }

    // If data has scenes
    if (data.scenes) {
        const scene = Array.isArray(data.scenes) ? data.scenes[0] : data.scenes;
        if (scene.layers) {
            result.layers = scene.layers.map(layer => ({
                id: layer.id || Math.random().toString(36).slice(2),
                type: layer.type || 'shape',
                name: layer.name || 'Layer',
                visible: layer.visible !== false,
                locked: layer.locked === true,
                blendMode: layer.blendMode || 'normal',
                opacity: layer.opacity || 1,
                transform: layer.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
                tracks: layer.tracks || {},
                effects: layer.effects || [],
                startTime: layer.startTime || 0,
                duration: layer.duration || result.duration,
                shapeData: layer.shapeData,
                textData: layer.textData,
                mediaData: layer.mediaData
            })).filter(l => l.type);
        }
    }

    return result;
}

module.exports = async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const url = req.query.url;
    if (!url) {
        res.status(400).json({ error: 'URL parameter required' });
        return;
    }

    // Validate URL
    if (!url.includes('alightcreative.com') && !url.includes('alight.creative')) {
        res.status(400).json({ error: 'Invalid URL — only Alight Creative links allowed' });
        return;
    }

    try {
        // Fetch the share page
        const response = await fetchUrl(url);

        if (response.status !== 200) {
            res.status(response.status).json({ error: `HTTP ${response.status}`, url });
            return;
        }

        // Try to extract JSON data from the page
        let data = extractJsonFromHtml(response.body);

        // If no JSON found, try to find API endpoints in the page
        if (!data) {
            const apiMatch = response.body.match(/https?:\/\/[^"'\s]+api[^"'\s]+/);
            if (apiMatch) {
                try {
                    const apiResponse = await fetchUrl(apiMatch[0]);
                    if (apiResponse.status === 200) {
                        data = JSON.parse(apiResponse.body);
                    }
                } catch (e) {
                    // Ignore API fetch errors
                }
            }
        }

        // If still no data, try to find script src with data
        if (!data) {
            const scriptMatches = response.body.match(/src="([^"]*\.js[^"]*)"/g);
            if (scriptMatches) {
                for (const match of scriptMatches) {
                    const scriptUrl = match.match(/src="([^"]+)"/)?.[1];
                    if (scriptUrl && (scriptUrl.includes('data') || scriptUrl.includes('config'))) {
                        try {
                            const scriptResponse = await fetchUrl(scriptUrl);
                            if (scriptResponse.status === 200) {
                                const scriptData = extractJsonFromHtml(scriptResponse.body);
                                if (scriptData) {
                                    data = scriptData;
                                    break;
                                }
                            }
                        } catch (e) {
                            continue;
                        }
                    }
                }
            }
        }

        // If we found data, extract preset
        if (data) {
            const preset = extractPresetFromData(data, url);
            res.status(200).json({ success: true, preset });
        } else {
            // Return a basic preset as fallback
            res.status(200).json({
                success: true,
                preset: {
                    name: 'Alight Preset (Basic)',
                    aspectRatio: '9:16',
                    fps: 30,
                    duration: 5,
                    width: 540,
                    height: 960,
                    backgroundColor: '#1a1a2e',
                    layers: [
                        {
                            id: 'bg',
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
                        }
                    ],
                    mediaSlots: [],
                    source: url,
                    note: 'Could not extract full preset data. Upload XML file for complete preset.'
                }
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message, url });
    }
};
