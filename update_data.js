const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

const DATA_FILE = path.join(__dirname, 'data', 'snap.json');
const IMAGES_DIR = path.join(__dirname, 'images', 'cards');

async function downloadAndResizeImage(url, destPath) {
    if (!url) return false;
    try {
        const response = await axios({
            url,
            responseType: 'arraybuffer',
            timeout: 10000
        });
        await sharp(response.data)
            .resize(260, 260, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp()
            .toFile(destPath);
        return true;
    } catch (e) {
        console.error(`Failed to download/resize ${url}:`, e.message);
        return false;
    }
}

function normalize(str) {
    return (str || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

(async () => {
    console.log("Starting update process using snap.fan API...");
    try {
        await fs.mkdir(IMAGES_DIR, { recursive: true });

        console.log("Fetching all cards from snap.fan...");
        let snapFanCards = [];
        let url = 'https://snap.fan/api/cards/';
        while (url) {
            const res = await axios.get(url);
            snapFanCards = snapFanCards.concat(res.data.results);
            url = res.data.next;
        }
        console.log(`Fetched ${snapFanCards.length} cards from snap.fan.`);

        console.log("Loading local snap.json...");
        const rawData = await fs.readFile(DATA_FILE, 'utf8');
        const snapData = JSON.parse(rawData);
        const localCards = snapData.data.cards.card || [];

        let maxId = 0;
        localCards.forEach(c => {
            const idNum = parseInt(c.id, 10);
            if (!isNaN(idNum) && idNum > maxId) maxId = idNum;
        });

        console.log(`Found ${localCards.length} local cards. Max ID: ${maxId}`);

        const usedSnapFanKeys = new Set();
        const downloadQueue = []; // { id, url }

        // Update existing cards
        let updatedCount = 0;
        for (const localCard of localCards) {
            let match = snapFanCards.find(sc => sc.name === localCard.name);
            if (!match) {
                match = snapFanCards.find(sc => normalize(sc.name) === normalize(localCard.name));
            }
            if (!match) {
                match = snapFanCards.find(sc => normalize(sc.key) === normalize(localCard.name));
            }
            if (!match && localCard.name.startsWith('Mr')) {
                const alt = localCard.name.replace(/^Mr/, 'Mister');
                match = snapFanCards.find(sc => normalize(sc.name) === normalize(alt) || normalize(sc.key) === normalize(alt));
            }

            if (match) {
                // Update stats
                localCard.energy = String(match.cost);
                localCard.power = String(match.power);
                if (match.description) {
                    localCard.desc = match.description.replace(/<[^>]*>?/gm, ''); // strip HTML
                }
                usedSnapFanKeys.add(match.key);
                
                let imageUrl = match.displayImageUrl;
                if (!imageUrl && match.variants && match.variants.length > 0) imageUrl = match.variants[0].imageUrl;
                
                if (imageUrl) {
                    downloadQueue.push({ id: localCard.id, url: imageUrl });
                }
                updatedCount++;
            }
        }
        console.log(`Updated stats for ${updatedCount} existing cards.`);

        // Add new cards
        let newCount = 0;
        for (const sc of snapFanCards) {
            if (sc.isReleased === false) continue; // Skip unreleased if we want, or include them? The old JSON had unreleased.
            if (!usedSnapFanKeys.has(sc.key) && sc.cost !== undefined && sc.power !== undefined) {
                maxId++;
                const newId = String(maxId);
                const newCard = {
                    id: newId,
                    name: sc.name,
                    energy: String(sc.cost),
                    power: String(sc.power),
                    desc: (sc.description || '').replace(/<[^>]*>?/gm, ''),
                    currentImage: true,
                    released: sc.isReleased !== false,
                    draftRarity: 1
                };
                localCards.push(newCard);
                
                let imageUrl = sc.displayImageUrl;
                if (!imageUrl && sc.variants && sc.variants.length > 0) imageUrl = sc.variants[0].imageUrl;
                
                if (imageUrl) {
                    downloadQueue.push({ id: newId, url: imageUrl });
                }
                newCount++;
            }
        }
        console.log(`Added ${newCount} new cards.`);

        // Save updated snap.json
        console.log("Writing snap.json...");
        await fs.writeFile(DATA_FILE, JSON.stringify(snapData, null, 2), 'utf8');

        console.log(`Downloading and resizing ${downloadQueue.length} images...`);
        const CONCURRENCY = 10;
        const failedIds = [];
        for (let i = 0; i < downloadQueue.length; i += CONCURRENCY) {
            const chunk = downloadQueue.slice(i, i + CONCURRENCY);
            await Promise.all(chunk.map(async (item) => {
                const destPath = path.join(IMAGES_DIR, `${item.id}.webp`);
                const success = await downloadAndResizeImage(item.url, destPath);
                if (!success) failedIds.push(item.id);
            }));
            console.log(`Processed images ${Math.min(i + chunk.length, downloadQueue.length)} / ${downloadQueue.length}`);
        }

        if (failedIds.length > 0) {
            console.log(`Failed to download images for ${failedIds.length} cards. Cleaning them out from JSON...`);
            // Optional: remove cards that failed image download
            const finalCards = snapData.data.cards.card.filter(c => !failedIds.includes(c.id));
            snapData.data.cards.card = finalCards;
            await fs.writeFile(DATA_FILE, JSON.stringify(snapData, null, 2), 'utf8');
            console.log("snap.json cleaned and re-saved.");
        }

        console.log("All done!");
    } catch (e) {
        console.error("Error during update:", e);
    }
})();
