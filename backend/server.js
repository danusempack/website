const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
    res.json({
        name: 'Ryo Motion Proxy',
        version: '1.0.0',
        endpoints: {
            '/api/alight-proxy': 'Fetch Alight Creative share link',
            '/api/gdrive-proxy': 'Fetch Google Drive file',
            '/api/health': 'Health check'
        }
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Alight Creative Proxy
app.get('/api/alight-proxy', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL parameter required' });
    }

    // Validate URL
    if (!url.includes('alightcreative.com') && !url.includes('alight.creative')) {
        return res.status(400).json({ error: 'Invalid URL — only Alight Creative links allowed' });
    }

    try {
        console.log(`[Alight Proxy] Fetching: ${url}`);

        // Fetch the share page
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                'Accept': 'text/html,application/json,*/*',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            redirect: 'follow'
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: `HTTP ${response.status}`, url });
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract project info from meta tags
        const projectName = $('meta[property="og:title"]').attr('content') || 'Alight Preset';
        const projectDesc = $('meta[property="og:description"]').attr('content') || '';
        const thumbnail = $('meta[property="og:image"]').attr('content') || '';

        // Try to find Firebase Storage data URLs
        const fbUrls = [];
        $('img').each((i, elem) => {
            const src = $(elem).attr('src') || '';
            if (src.includes('firebasestorage.googleapis.com')) {
                fbUrls.push(src);
            }
        });

        // Try to find any data URLs in the page
        const dataUrls = [];
        const scripts = $('script');
        scripts.each((i, elem) => {
            const content = $(elem).html() || '';
            const matches = content.match(/https?:\/\/[^"'\s]+/g) || [];
            matches.forEach(match => {
                if (match.includes('data') || match.includes('preset') || match.includes('project')) {
                    dataUrls.push(match);
                }
            });
        });

        // Try to fetch Firebase Storage data
        let presetData = null;
        for (const fbUrl of fbUrls) {
            try {
                const fbResponse = await fetch(fbUrl);
                if (fbResponse.ok) {
                    const fbData = await fbResponse.text();
                    if (fbData && !fbData.startsWith('<')) {
                        try {
                            presetData = JSON.parse(fbData);
                            break;
                        } catch (e) {
                            // Not JSON, continue
                        }
                    }
                }
            } catch (e) {
                continue;
            }
        }

        // If no preset data found, try to find API endpoints
        if (!presetData) {
            // Look for API endpoints in the page
            const apiMatches = html.match(/https?:\/\/[^"'\s]+api[^"'\s]+/g) || [];
            for (const apiUrl of apiMatches) {
                try {
                    const apiResponse = await fetch(apiUrl);
                    if (apiResponse.ok) {
                        const apiData = await apiResponse.json();
                        if (apiData && (apiData.layers || apiData.project || apiData.preset)) {
                            presetData = apiData;
                            break;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }
        }

        // Return result
        if (presetData) {
            res.json({
                success: true,
                preset: {
                    name: presetData.name || projectName,
                    aspectRatio: presetData.aspectRatio || '9:16',
                    fps: presetData.fps || 30,
                    duration: presetData.duration || 5,
                    width: presetData.width || 540,
                    height: presetData.height || 960,
                    backgroundColor: presetData.backgroundColor || '#000000',
                    layers: presetData.layers || [],
                    mediaSlots: presetData.mediaSlots || [],
                    source: url
                }
            });
        } else {
            // Return basic preset as fallback
            res.json({
                success: true,
                preset: {
                    name: projectName,
                    aspectRatio: '9:16',
                    fps: 30,
                    duration: 5,
                    width: 540,
                    height: 960,
                    backgroundColor: '#1a1a2e',
                    layers: [{
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
                    }],
                    mediaSlots: [],
                    source: url,
                    note: 'Could not extract full preset data. Upload XML file for complete preset.'
                }
            });
        }

    } catch (error) {
        console.error('[Alight Proxy] Error:', error.message);
        res.status(500).json({ error: error.message, url });
    }
});

// Google Drive Proxy
app.get('/api/gdrive-proxy', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL parameter required' });
    }

    // Extract file ID
    const fileIdMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (!fileIdMatch) {
        return res.status(400).json({ error: 'Invalid Google Drive URL' });
    }

    const fileId = fileIdMatch[1];
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    try {
        console.log(`[GDrive Proxy] Fetching: ${downloadUrl}`);

        const response = await fetch(downloadUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
            },
            redirect: 'follow'
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: `HTTP ${response.status}` });
        }

        const text = await response.text();

        // Check if response is HTML (preview page)
        if (text.trim().startsWith('<') || text.includes('<!DOCTYPE html>')) {
            return res.status(400).json({ error: 'Google Drive return preview page. Make sure file is shared publicly.' });
        }

        res.json({
            success: true,
            content: text,
            contentType: response.headers.get('content-type')
        });

    } catch (error) {
        console.error('[GDrive Proxy] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Ryo Motion Proxy running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
});
