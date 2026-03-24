// ================================================================
//  SEARCH & FILTER
// ================================================================
import { t } from './i18n.js';

let allProducts = [];    // full product list from snapshot
let filterCallback = null;
let debounceTimer = null;

export function setProducts(products) { allProducts = products; applyFilters(); }
export function onFilterChange(cb) { filterCallback = cb; }

function hasTextValue(value) {
    return Boolean((value || '').trim());
}

function hasAnyVariationValue(variations, key) {
    return Array.isArray(variations) && variations.some((variation) => hasTextValue(variation?.[key]));
}

function hasAnyVariationPrice(variations) {
    return Array.isArray(variations) && variations.some((variation) => variation?.wholesalePrice != null || variation?.retailPrice != null);
}

function isMissingDetail(product, missingDetail) {
    const data = product.data || {};
    const missingName = !hasTextValue(data.name);
    const missingDescription = !hasTextValue(data.description);
    const missingSku = data.hasVariations ? !hasAnyVariationValue(data.variations, 'sku') : !hasTextValue(data.sku);
    const missingPrice = data.hasVariations
        ? !hasAnyVariationPrice(data.variations)
        : (data.wholesalePrice == null && data.retailPrice == null);

    switch (missingDetail) {
    case 'incomplete':
        return missingName || missingSku || missingPrice || missingDescription;
    case 'name':
        return missingName;
    case 'sku':
        return missingSku;
    case 'price':
        return missingPrice;
    case 'description':
        return missingDescription;
    default:
        return false;
    }
}

function applyFilters() {
    const searchEl = document.getElementById('search-text');
    const catEl    = document.getElementById('search-cat');
    const imageEl  = document.getElementById('search-image-status');
    const missingEl = document.getElementById('search-missing-detail');
    const minEl    = document.getElementById('search-price-min');
    const maxEl    = document.getElementById('search-price-max');

    if (!searchEl) return;

    const text   = searchEl.value.trim().toLowerCase();
    const catId  = catEl.value;
    const imageStatus = imageEl ? imageEl.value : '';
    const missingDetail = missingEl ? missingEl.value : '';
    const minP   = minEl.value ? parseFloat(minEl.value) : null;
    const maxP   = maxEl.value ? parseFloat(maxEl.value) : null;

    let filtered = allProducts;

    // Text search
    if (text) {
        filtered = filtered.filter(p => {
            const name = (p.data.name || '').toLowerCase();
            const sku  = (p.data.sku || '').toLowerCase();
            const desc = (p.data.description || '').toLowerCase();
            if (name.includes(text) || sku.includes(text) || desc.includes(text)) return true;
            // Search in variations
            if (p.data.hasVariations && Array.isArray(p.data.variations)) {
                return p.data.variations.some(v =>
                    (v.label || '').toLowerCase().includes(text) ||
                    (v.sku || '').toLowerCase().includes(text)
                );
            }
            return false;
        });
    }

    // Category filter
    if (catId === '__uncategorized__') {
        filtered = filtered.filter(p => !p.data.categoryId);
    } else if (catId) {
        filtered = filtered.filter(p => p.data.categoryId === catId);
    }

    // Image workflow status
    if (imageStatus) {
        filtered = filtered.filter(p => {
            const status = p.data.imageStatus || (p.data.editedImageUrl ? 'edited' : 'raw');
            return status === imageStatus;
        });
    }

    // Missing detail filter
    if (missingDetail) {
        filtered = filtered.filter((product) => isMissingDetail(product, missingDetail));
    }

    // Price range
    if (minP !== null || maxP !== null) {
        filtered = filtered.filter(p => {
            let prices = [];
            if (p.data.hasVariations && Array.isArray(p.data.variations)) {
                prices = p.data.variations.map(v => v.wholesalePrice).filter(v => v != null);
            } else if (p.data.wholesalePrice != null) {
                prices = [p.data.wholesalePrice];
            }
            if (prices.length === 0) return false;
            if (minP !== null && !prices.some(pr => pr >= minP)) return false;
            if (maxP !== null && !prices.some(pr => pr <= maxP)) return false;
            return true;
        });
    }

    // Update count display
    const countEl = document.getElementById('search-result-count');
    if (countEl) {
        if (text || catId || imageStatus || missingDetail || minP !== null || maxP !== null) {
            countEl.textContent = `${t('searchShowing')} ${filtered.length} ${t('searchOf')} ${allProducts.length}`;
            countEl.style.display = '';
        } else {
            countEl.style.display = 'none';
        }
    }

    if (filterCallback) filterCallback(filtered);
}

export function initSearch() {
    const searchEl = document.getElementById('search-text');
    const catEl    = document.getElementById('search-cat');
    const imageEl  = document.getElementById('search-image-status');
    const missingEl = document.getElementById('search-missing-detail');
    const minEl    = document.getElementById('search-price-min');
    const maxEl    = document.getElementById('search-price-max');
    const clearBtn = document.getElementById('search-clear');

    if (searchEl) {
        searchEl.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(applyFilters, 300);
        });
    }
    if (catEl)  catEl.addEventListener('change', applyFilters);
    if (imageEl) imageEl.addEventListener('change', applyFilters);
    if (missingEl) missingEl.addEventListener('change', applyFilters);
    if (minEl)  minEl.addEventListener('input', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(applyFilters, 500); });
    if (maxEl)  maxEl.addEventListener('input', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(applyFilters, 500); });
    if (clearBtn) clearBtn.addEventListener('click', clearFilters);
}

export function clearFilters() {
    const searchEl = document.getElementById('search-text');
    const catEl    = document.getElementById('search-cat');
    const imageEl  = document.getElementById('search-image-status');
    const missingEl = document.getElementById('search-missing-detail');
    const minEl    = document.getElementById('search-price-min');
    const maxEl    = document.getElementById('search-price-max');
    if (searchEl) searchEl.value = '';
    if (catEl) catEl.value = '';
    if (imageEl) imageEl.value = '';
    if (missingEl) missingEl.value = '';
    if (minEl) minEl.value = '';
    if (maxEl) maxEl.value = '';
    applyFilters();
}

// Update category dropdown in search bar (called from categories module)
export function updateSearchCategories(categories) {
    const catEl = document.getElementById('search-cat');
    if (!catEl) return;
    const currentVal = catEl.value;
    catEl.innerHTML = `<option value="">${t('catAll')}</option><option value="__uncategorized__">${t('catUncategorized')}</option>`;

    // Build flat indented list
    const topLevel = categories.filter(c => !c.parentId);
    const getChildren = (pid) => categories.filter(c => c.parentId === pid);
    function walk(nodes, depth) {
        for (const n of nodes) {
            const opt = document.createElement('option');
            opt.value = n.id;
            opt.textContent = '\u2014'.repeat(depth) + ' ' + n.name;
            catEl.appendChild(opt);
            walk(getChildren(n.id), depth + 1);
        }
    }
    walk(topLevel, 0);
    catEl.value = currentVal || '';
}
