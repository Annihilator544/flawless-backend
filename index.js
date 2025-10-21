require('dotenv').config();

const express = require('express');
const { fetchInventoryData, processInventoryData } = require('./inventory');
const app = express()
const port = 5000

app.use(cors({
  origin: ['http://localhost:3000', 'https://v0-flawless-vape-dashboard-five.vercel.app/'],
  credentials: true
}));

// Configuration
const VEEQO_STORE = process.env.VEEQO_STORE
const VEEQO_ACCESS_TOKEN = process.env.VEEQO_ACCESS_TOKEN

console.log('VEEQO_STORE:', VEEQO_STORE, 'VEEQO_ACCESS_TOKEN:', VEEQO_ACCESS_TOKEN);

// Cache object
let inventoryCache = {
  data: null,
  timestamp: null,
  ttl: 240 * 60 * 1000, // 240 minutes cache 
  isRevalidating: false
}

// Background revalidation function
async function revalidateCache() {
  if (inventoryCache.isRevalidating) {
    console.log('⏳ Revalidation already in progress, skipping...');
    return;
  }

  try {
    inventoryCache.isRevalidating = true;
    console.log('🔄 Background revalidation started...');
    
    const data = await fetchInventoryData();
    const dataSizeMB = Buffer.byteLength(JSON.stringify(data)) / (1024 * 1024);
    console.log(`Fetched inventory data size: ${dataSizeMB.toFixed(2)} MB`);
    
    const processedData = processInventoryData(data);
    const dataSizeMB2 = Buffer.byteLength(JSON.stringify(processedData)) / (1024 * 1024);
    console.log(`Processed inventory data size: ${dataSizeMB2.toFixed(2)} MB`);
    
    // Update cache
    inventoryCache.data = processedData;
    inventoryCache.timestamp = Date.now();
    
    console.log('✅ Cache revalidated successfully at', new Date().toISOString());
  } catch (error) {
    console.error('❌ Error during background revalidation:', error);
  } finally {
    inventoryCache.isRevalidating = false;
  }
}

// Auto-revalidate cache on interval
setInterval(async () => {
  const now = Date.now();
  
  // Check if cache exists and is stale
  if (inventoryCache.data && inventoryCache.timestamp && 
      (now - inventoryCache.timestamp >= inventoryCache.ttl)) {
    console.log('🔔 Cache is stale, triggering auto-revalidation...');
    revalidateCache();
  }
}, 60 * 1000); // Check every minute

// Route to serve inventory data with caching
app.get('/api/inventory', async (req, res) => {
  try {
    const now = Date.now();
    
    // If cache exists (even if stale), serve it immediately
    if (inventoryCache.data) {
      const cacheAge = now - inventoryCache.timestamp;
      const isCacheStale = cacheAge >= inventoryCache.ttl;
      
      // If cache is stale and not currently revalidating, trigger background revalidation
      if (isCacheStale && !inventoryCache.isRevalidating) {
        console.log('🔄 Cache is stale, triggering background revalidation...');
        revalidateCache(); // Don't await - let it run in background
      }
      
      console.log(`✅ Serving ${isCacheStale ? 'stale' : 'fresh'} cache`);
      return res.json({
        data: inventoryCache.data,
        cached: true,
        stale: isCacheStale,
        revalidating: inventoryCache.isRevalidating,
        cachedAt: new Date(inventoryCache.timestamp).toISOString(),
        cacheAge: Math.round(cacheAge / 1000) + ' seconds'
      });
    }

    // No cache exists - fetch fresh data and wait
    console.log('🔄 No cache found, fetching fresh inventory data...');
    const data = await fetchInventoryData();
    const dataSizeMB = Buffer.byteLength(JSON.stringify(data)) / (1024 * 1024);
    console.log(`Fetched inventory data size: ${dataSizeMB.toFixed(2)} MB`);
    
    const processedData = processInventoryData(data);
    const dataSizeMB2 = Buffer.byteLength(JSON.stringify(processedData)) / (1024 * 1024);
    console.log(`Processed inventory data size: ${dataSizeMB2.toFixed(2)} MB`);
    
    // Update cache
    inventoryCache.data = processedData;
    inventoryCache.timestamp = now;

    res.json({
      data: processedData,
      cached: false,
      stale: false,
      revalidating: false,
      cachedAt: new Date(now).toISOString()
    });

  } catch (error) {
    console.error('Error in /api/inventory:', error);
    res.status(500).json({ 
      error: 'Failed to fetch inventory data',
      message: error.message 
    });
  }
});

// Manual revalidation endpoint (optional)
app.post('/api/inventory/revalidate', async (req, res) => {
  console.log('📝 Manual revalidation triggered');
  revalidateCache(); // Don't await
  res.json({ 
    message: 'Cache revalidation triggered',
    isRevalidating: inventoryCache.isRevalidating
  });
});

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})