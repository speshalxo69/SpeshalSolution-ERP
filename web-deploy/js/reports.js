// ================================================================
//  REPORTS DASHBOARD
// ================================================================
import { t } from './i18n.js';
import { getCategories, getCategoryName } from './categories.js';

let reportVisible = false;

export function isReportVisible() { return reportVisible; }

export function toggleReports(allProducts) {
    reportVisible = !reportVisible;
    const contentArea = document.getElementById('content-area');
    const reportView  = document.getElementById('report-view');

    if (reportVisible) {
        contentArea.style.display = 'none';
        reportView.style.display = '';
        renderReports(allProducts);
    } else {
        contentArea.style.display = '';
        reportView.style.display = 'none';
    }
}

export function hideReports() {
    reportVisible = false;
    const contentArea = document.getElementById('content-area');
    const reportView  = document.getElementById('report-view');
    if (contentArea) contentArea.style.display = '';
    if (reportView) reportView.style.display = 'none';
}

export function renderReports(allProducts) {
    const container = document.getElementById('report-content');
    if (!container) return;

    const products = allProducts.map(p => p.data);
    const categories = getCategories();

    const totalProducts = products.length;
    const totalCategories = categories.length;
    const withVariations = products.filter(p => p.hasVariations).length;
    const uncategorized = products.filter(p => !p.categoryId).length;

    // ── Summary Cards ──
    let html = `
    <div class="report-cards">
        <div class="report-card">
            <div class="report-card-number">${totalProducts}</div>
            <div class="report-card-label">${t('reportTotalProducts')}</div>
        </div>
        <div class="report-card">
            <div class="report-card-number">${totalCategories}</div>
            <div class="report-card-label">${t('reportTotalCategories')}</div>
        </div>
        <div class="report-card">
            <div class="report-card-number">${withVariations}</div>
            <div class="report-card-label">${t('reportWithVariations')}</div>
        </div>
        <div class="report-card">
            <div class="report-card-number">${uncategorized}</div>
            <div class="report-card-label">${t('reportUncategorized')}</div>
        </div>
    </div>`;

    // ── Category Breakdown ──
    const catCounts = {};
    const catPrices = {};
    products.forEach(p => {
        const catId = p.categoryId || '__none__';
        catCounts[catId] = (catCounts[catId] || 0) + 1;
        let price = null;
        if (p.hasVariations && Array.isArray(p.variations) && p.variations.length > 0) {
            const prices = p.variations.map(v => v.wholesalePrice).filter(v => v != null);
            if (prices.length > 0) price = prices.reduce((a, b) => a + b, 0) / prices.length;
        } else if (p.wholesalePrice != null) {
            price = p.wholesalePrice;
        }
        if (price !== null) {
            if (!catPrices[catId]) catPrices[catId] = [];
            catPrices[catId].push(price);
        }
    });

    html += `
    <div class="groupbox" style="margin-top:8px;">
        <div class="section-label">${t('reportCategoryBreakdown')}</div>
        <table class="report-table">
            <thead>
                <tr>
                    <th>${t('reportColCategory')}</th>
                    <th>${t('reportColCount')}</th>
                    <th>${t('reportColAvgPrice')}</th>
                </tr>
            </thead>
            <tbody>`;

    // Sort by count desc
    const catEntries = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
    catEntries.forEach(([catId, count]) => {
        const name = catId === '__none__' ? t('catUncategorized') : (getCategoryName(catId) || t('catUncategorized'));
        const prices = catPrices[catId] || [];
        const avg = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : '—';
        const avgDisplay = typeof avg === 'number' ? `${avg.toLocaleString()} ${t('currency')}` : avg;
        html += `<tr><td>${name}</td><td>${count}</td><td>${avgDisplay}</td></tr>`;
    });

    html += `</tbody></table></div>`;

    // ── Price Distribution ──
    const buckets = [
        { label: '0 - 500', min: 0, max: 500 },
        { label: '500 - 1,000', min: 500, max: 1000 },
        { label: '1,000 - 5,000', min: 1000, max: 5000 },
        { label: '5,000 - 10,000', min: 5000, max: 10000 },
        { label: '10,000+', min: 10000, max: Infinity },
    ];

    const bucketCounts = buckets.map(() => 0);
    products.forEach(p => {
        let prices = [];
        if (p.hasVariations && Array.isArray(p.variations)) {
            prices = p.variations.map(v => v.wholesalePrice).filter(v => v != null);
        } else if (p.wholesalePrice != null) {
            prices = [p.wholesalePrice];
        }
        prices.forEach(price => {
            for (let i = 0; i < buckets.length; i++) {
                if (price >= buckets[i].min && price < buckets[i].max) {
                    bucketCounts[i]++;
                    break;
                }
            }
        });
    });

    const maxBucket = Math.max(...bucketCounts, 1);

    html += `
    <div class="groupbox" style="margin-top:8px;">
        <div class="section-label">${t('reportPriceDistribution')}</div>
        <div class="report-bars">`;

    buckets.forEach((b, i) => {
        const pct = Math.round((bucketCounts[i] / maxBucket) * 100);
        html += `
        <div class="report-bar-row">
            <span class="report-bar-label">${b.label} ${t('currency')}</span>
            <div class="report-bar-track">
                <div class="report-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="report-bar-count">${bucketCounts[i]}</span>
        </div>`;
    });

    html += `</div></div>`;

    container.innerHTML = html;
}
