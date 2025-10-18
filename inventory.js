const VEEQO_STORE = process.env.VEEQO_STORE;
const VEEQO_ACCESS_TOKEN = process.env.VEEQO_ACCESS_TOKEN;

// Helper function to fetch a single page
async function fetchPage(pageNumber) {
  const response = await fetch(
    `${VEEQO_STORE}/products?page_size=100&page=${pageNumber}`,
    {
      method: 'GET',
      headers: {
        'X-API-KEY': VEEQO_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    console.error(`Veeqo API error on page ${pageNumber}:`, response.statusText, response.status);
    const errorData = await response.json();
    throw new Error(`Failed to fetch page ${pageNumber}: ${JSON.stringify(errorData)}`);
  }

  return await response.json();
}


async function fetchInventoryData() {
  try {
    // Fetch first page to get total pages
    const firstPageResponse = await fetch(
      `${VEEQO_STORE}/products?page_size=100&page=1`,
      {
        method: 'GET',
        headers: {
          'X-API-KEY': VEEQO_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!firstPageResponse.ok) {
      const errorData = await firstPageResponse.json();
      console.error('Veeqo API error:', errorData);
      throw new Error('Failed to fetch products');
    }

    const firstPageData = await firstPageResponse.json();

    // Extract pagination headers
    const totalPages = parseInt(
      firstPageResponse.headers.get('X-Total-Pages-Count') || '1'
    );
    const totalRecords = firstPageResponse.headers.get('X-Total-Count');
    const perPage = firstPageResponse.headers.get('X-Per-Page');

    console.log('Pagination info:', {
      totalPages,
      totalRecords,
      perPage,
      firstPageProducts: firstPageData.length,
    });

    // If only one page, return immediately
    if (totalPages <= 1) {
      console.log(`Total products fetched: ${firstPageData.length}`);
      return firstPageData;
    }

    // Create array of remaining page numbers (2 to totalPages)
    const remainingPages = Array.from(
      { length: totalPages - 1 },
      (_, i) => i + 2
    );
    console.log(`Total remaining pages to fetch: ${remainingPages.length}`);

    console.log(
      `Fetching ${remainingPages.length} remaining pages in parallel...`
    );

    // Fetch all remaining pages in parallel with batching
    const batchSize = 5;
    const allProducts = [...firstPageData];

    for (let i = 0; i < remainingPages.length; i += batchSize) {
      const batch = remainingPages.slice(i, i + batchSize);
      console.log(
        `Fetching batch: pages ${batch[0]} to ${batch[batch.length - 1]}`
      );

      const batchResults = await Promise.all(
        batch.map((pageNumber) => fetchPage(pageNumber))
      );

      batchResults.forEach((pageData) => {
        allProducts.push(...pageData);
      });

      console.log(
        `Progress: ${allProducts.length} products fetched so far...`
      );
    }

    console.log(`Total products fetched: ${allProducts.length}`);
    return allProducts;

  } catch (error) {
    console.error('❌ Server: Error fetching Inventory data:', error);
    throw error;
  }
}

const processInventoryData = (products) => {
            const processedProducts = products.flatMap(
                (product) =>
                    product.sellables.map((sellable) => {
                        const stockLevel =
                            sellable.inventory
                                ?.physical_stock_level_at_all_warehouses || 0;
                        const allocatedStock =
                            sellable.inventory
                                ?.allocated_stock_level_at_all_warehouses || 0;
                        const availableStock =
                            sellable.inventory
                                ?.available_stock_level_at_all_warehouses || 0;
                        const totalSold = sellable.total_quantity_sold || 0;
                        const reorderLevel = sellable.min_reorder_level || 5;

                        const turnoverRate =
                            stockLevel > 0 ? (totalSold / stockLevel) * 100 : 0;
                        const avgDailySales = totalSold / 365;
                        const daysOfStockRemaining =
                            avgDailySales > 0
                                ? availableStock / avgDailySales
                                : Infinity;
                        const stockValue =
                            availableStock * (sellable.cost_price || 0);
                        const status = calculateStockStatus(
                            availableStock,
                            totalSold,
                            reorderLevel
                        );

                        return {
                            id: product.id,
                            title: sellable.full_title || product.title,
                            sku: sellable.sku_code,
                            price: sellable.price || 0,
                            costPrice: sellable.cost_price || 0,
                            stockLevel,
                            allocatedStock,
                            availableStock,
                            totalSold,
                            profit: sellable.profit || 0,
                            margin: sellable.margin || 0,
                            imageUrl:
                                sellable.image_url || product.thumbnail_url,
                            isLowStock:
                                availableStock <= reorderLevel &&
                                availableStock > 0,
                            isOutOfStock: availableStock === 0,
                            reorderLevel,
                            turnoverRate: Math.round(turnoverRate * 100) / 100,
                            stockValue: Math.round(stockValue * 100) / 100,
                            daysOfStockRemaining:
                                Math.round(daysOfStockRemaining),
                            status,
                        };
                    })
            );
            const lowStockProducts = processedProducts
                .filter((p) => p.isLowStock)
            const outOfStockProducts = processedProducts
                .filter((p) => p.isOutOfStock)
            const topSellingProducts = [...processedProducts]
                .sort((a, b) => b.totalSold - a.totalSold)
                .slice(0, 20);

            const totalStockValue = processedProducts.reduce(
                (sum, p) => sum + p.stockValue,
                0
            );

            const statusCounts = {
                critical: processedProducts.filter(
                    (p) => p.status === 'critical'
                ).length,
                low: processedProducts.filter((p) => p.status === 'low').length,
                adequate: processedProducts.filter(
                    (p) => p.status === 'adequate'
                ).length,
                good: processedProducts.filter((p) => p.status === 'good')
                    .length,
                overstock: processedProducts.filter(
                    (p) => p.status === 'overstock'
                ).length,
            };

            const stockStatusDistribution = [
                {
                    name: 'Critical (Out of Stock)',
                    value: statusCounts.critical,
                    color: STATUS_COLORS.critical,
                },
                {
                    name: 'Low Stock',
                    value: statusCounts.low,
                    color:  STATUS_COLORS.low,
                },
                {
                    name: 'Adequate',
                    value: statusCounts.adequate,
                    color: STATUS_COLORS.adequate,
                },
                {
                    name: 'Good',
                    value: statusCounts.good,
                    color: STATUS_COLORS.good,
                },
                {
                    name: 'Overstock',
                    value: statusCounts.overstock,
                    color: STATUS_COLORS.overstock,
                },
            ].filter((s) => s.value > 0);

            const avgTurnoverRate =
                processedProducts.length > 0
                    ? processedProducts.reduce(
                          (sum, p) => sum + p.turnoverRate,
                          0
                      ) / processedProducts.length
                    : 0;

            const categoryMap = new Map();
            processedProducts.forEach((p) => {
                const category = p.title.split(' ')[0] || 'Other';
                const existing = categoryMap.get(category) || {
                    stockLevel: 0,
                    value: 0,
                };
                existing.stockLevel += p.availableStock;
                existing.value += p.stockValue;
                categoryMap.set(category, existing);
            });

            const topCategories = Array.from(categoryMap.entries())
                .map(([name, data]) => ({ name, ...data }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 10);

            return {
                products: processedProducts,
                lowStockProducts,
                outOfStockProducts,
                topSellingProducts,
                totalProducts: processedProducts.length,
                totalStockValue: Math.round(totalStockValue * 100) / 100,
                lowStockCount: lowStockProducts.length,
                outOfStockCount: outOfStockProducts.length,
                averageTurnoverRate: Math.round(avgTurnoverRate * 100) / 100,
                stockStatusDistribution,
                topCategories,
            };
        }
const calculateStockStatus = 
                (
                    available,
                    sold,
                    reorderLevel
                )=> {
                    if (available === 0) return 'critical';
                    if (available <= reorderLevel) return 'low';
        
                    const avgDailySales = sold / 365;
                    const daysOfStock = available / (avgDailySales || 0.1);
        
                    if (daysOfStock < 7) return 'low';
                    if (daysOfStock < 30) return 'adequate';
                    if (daysOfStock < 90) return 'good';
                    return 'overstock';
                }


const COLORS = [
    '#0088FE',
    '#00C49F',
    '#FFBB28',
    '#FF8042',
    '#8884D8',
    '#82CA9D',
    '#fbbf24',
    '#ef4444',
];
const STATUS_COLORS = {
    critical: '#ef4444',
    low: '#f97316',
    adequate: '#eab308',
    good: '#10b981',
    overstock: '#3b82f6',
};

const ITEMS_PER_PAGE = 50;

module.exports = { fetchInventoryData, processInventoryData };