import { LOCAL_USERS, CLOUDINARY_CLOUD, CLOUDINARY_PRESET } from './config.js';
import {
    auth, db, signInAnonymously, signOut, onAuthStateChanged,
    collection, addDoc, setDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp,
} from './firebase-init.js';
import { t, setLang } from './i18n.js';
import { setStatus, showMsg, hideMsg, formatBytes, placeholderSvg } from './helpers.js';
import {
    startCategoriesListener, stopCategoriesListener, showCategoryPanel, addCategory,
    getCategories, getCategoryName, onCategoriesChange, populateCategoryDropdowns, win95Input, win95Confirm,
} from './categories.js';
import { initSearch, setProducts, onFilterChange, updateSearchCategories } from './search.js';
import { initMenuBar, setMenuActions, showAboutDialog, showPreferencesDialog, showShortcutsDialog } from './menu-bar.js';
import { hideReports, renderReports, isReportVisible } from './reports.js';

let unsubscribeFirestore = null;
let localUsername = null;
let currentUserRole = 'viewer';
let allProducts = [];
let selectedFile = null;
let formMode = 'simple';
let editingDocId = null;
let currentSort = 'date';
let currentAppMode = 'catalog';
let designerPinUnlocked = false;
let filteredProducts = [];
let bulkDownloadInProgress = false;
const DESIGNER_PIN = '1994';
const uploadingImageIds = new Set();

const loginScreen = document.getElementById('login-screen');
const mainWindow = document.getElementById('main-window');
const contentArea = document.getElementById('content-area');
const btnLogin = document.getElementById('btn-login');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const btnSignout = document.getElementById('btn-signout');
const userName = document.getElementById('user-name');
const modeSwitcher = document.getElementById('mode-switcher');
const btnModeCatalog = document.getElementById('btn-mode-catalog');
const btnModeDesigner = document.getElementById('btn-mode-designer');
const designerBanner = document.getElementById('designer-banner');
const searchImageStatus = document.getElementById('search-image-status');
const searchMissingDetail = document.getElementById('search-missing-detail');
const btnDownloadFilteredOriginals = document.getElementById('btn-download-filtered-originals');
const sectionDb = document.getElementById('t-section-db');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const dropHint = document.getElementById('drop-hint');
const btnSave = document.getElementById('btn-save');
const btnClear = document.getElementById('btn-clear');
const galleryGrid = document.getElementById('gallery-grid');
const productCount = document.getElementById('product-count');
const statusDb = document.getElementById('status-db');
const progressWrap = document.getElementById('progress-wrap');
const progressFill = document.getElementById('progress-fill');
const fName = document.getElementById('f-name');
const fSku = document.getElementById('f-sku');
const fWs = document.getElementById('f-ws');
const fRetail = document.getElementById('f-retail');
const fMoq = document.getElementById('f-moq');
const fDesc = document.getElementById('f-desc');
const fCat = document.getElementById('f-category');

const editOverlay = document.getElementById('edit-overlay');
const editError = document.getElementById('edit-error');
const btnEditSave = document.getElementById('btn-edit-save');
const btnEditCancel = document.getElementById('btn-edit-cancel');
const btnEditClose = document.getElementById('btn-edit-close');
const btnEditDownloadOriginal = document.getElementById('btn-edit-download-original');
const btnEditDownloadEdited = document.getElementById('btn-edit-download-edited');
const btnEditUploadImage = document.getElementById('btn-edit-upload-image');
const btnEditDeleteEdited = document.getElementById('btn-edit-delete-edited');
const editImageInput = document.getElementById('edit-image-input');
const editOriginalPreview = document.getElementById('edit-original-preview');
const editCurrentPreview = document.getElementById('edit-current-preview');
const editImageMeta = document.getElementById('edit-image-meta');
const editImageStatusLabel = document.getElementById('edit-image-status-label');
const eName = document.getElementById('e-name');
const eSku = document.getElementById('e-sku');
const eWs = document.getElementById('e-ws');
const eRetail = document.getElementById('e-retail');
const eMoq = document.getElementById('e-moq');
const eDesc = document.getElementById('e-desc');
const eCat = document.getElementById('e-category');

function canUseDesignerMode() {
    return currentUserRole === 'admin' || currentUserRole === 'designer';
}

function getDefaultModeForRole() {
    return 'catalog';
}

function getOriginalImageUrl(product) {
    return product.originalImageUrl || product.imageUrl || '';
}

function getEditedImageUrl(product) {
    return product.editedImageUrl || '';
}

function getCurrentImageUrl(product) {
    return product.currentImageUrl || product.editedImageUrl || product.imageUrl || '';
}

function getImageStatus(product) {
    return product.imageStatus || (product.editedImageUrl ? 'edited' : 'raw');
}

function getImageStatusKey(product) {
    return getImageStatus(product) === 'edited' ? 'imageStatusEdited' : 'imageStatusRaw';
}

function buildInitialImageFields(imageUrl) {
    return {
        imageUrl,
        originalImageUrl: imageUrl,
        currentImageUrl: imageUrl,
        editedImageUrl: '',
        imageStatus: 'raw',
    };
}

function getProductById(productId) {
    return allProducts.find((entry) => entry.id === productId) || null;
}

function formatTimestamp(value) {
    if (!value) return '';
    if (typeof value.toDate === 'function') return value.toDate().toLocaleString();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toLocaleString();
    return '';
}

function sanitizeFilename(value) {
    const cleaned = (value || 'product-image').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    return cleaned || 'product-image';
}

function guessExtension(url, contentType = '') {
    const cleanUrl = (url || '').split('?')[0];
    const match = cleanUrl.match(/\.([a-zA-Z0-9]{3,4})$/);
    if (match) return `.${match[1].toLowerCase()}`;
    if (contentType.includes('png')) return '.png';
    if (contentType.includes('webp')) return '.webp';
    if (contentType.includes('gif')) return '.gif';
    return '.jpg';
}

let jsZipPromise = null;

function getZipLibrary() {
    if (!jsZipPromise) {
        jsZipPromise = import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')
            .then((module) => module.default || module)
            .catch((error) => {
                jsZipPromise = null;
                throw error;
            });
    }
    return jsZipPromise;
}

const CSV_PRODUCT_HEADERS = [
    'id', 'name', 'description', 'categoryId', 'categoryName',
    'hasVariations', 'sku', 'wholesalePrice', 'retailPrice', 'moq', 'variations',
    'imageUrl', 'originalImageUrl', 'currentImageUrl', 'editedImageUrl', 'imageStatus',
    'uploadedBy', 'editedBy', 'editedAt',
];

function toCsvSafeValue(value) {
    const text = value == null ? '' : String(value);
    if (!/[",\n\r]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
}

function toCsvDate(value) {
    if (!value) return '';
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function buildProductsCsv() {
    const lines = [CSV_PRODUCT_HEADERS.join(',')];
    allProducts.forEach(({ id, data }) => {
        const row = {
            id,
            name: data.name || '',
            description: data.description || '',
            categoryId: data.categoryId || '',
            categoryName: getCategoryName(data.categoryId) || '',
            hasVariations: data.hasVariations ? 'true' : 'false',
            sku: data.sku || '',
            wholesalePrice: data.wholesalePrice ?? '',
            retailPrice: data.retailPrice ?? '',
            moq: data.moq ?? '',
            variations: data.hasVariations ? JSON.stringify(data.variations || []) : '',
            imageUrl: data.imageUrl || '',
            originalImageUrl: data.originalImageUrl || '',
            currentImageUrl: data.currentImageUrl || '',
            editedImageUrl: data.editedImageUrl || '',
            imageStatus: data.imageStatus || '',
            uploadedBy: data.uploadedBy || '',
            editedBy: data.editedBy || '',
            editedAt: toCsvDate(data.editedAt),
        };
        lines.push(CSV_PRODUCT_HEADERS.map((header) => toCsvSafeValue(row[header])).join(','));
    });
    return `\uFEFF${lines.join('\r\n')}`;
}

function downloadTextFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}

function exportProductsCsv() {
    const filename = `${sanitizeFilename('products-export')}-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadTextFile(filename, buildProductsCsv(), 'text/csv;charset=utf-8;');
    setStatus(t('csvExportDone'));
    showMsg(t('csvExportDone'), 'success');
}

function parseCsvText(text) {
    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inQuotes) {
            if (char === '"') {
                if (text[index + 1] === '"') {
                    value += '"';
                    index += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                value += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(value);
            value = '';
        } else if (char === '\n') {
            row.push(value);
            rows.push(row);
            row = [];
            value = '';
        } else if (char !== '\r') {
            value += char;
        }
    }

    row.push(value);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    if (rows.length === 0) return [];

    const headers = rows[0].map((header) => header.trim());
    return rows
        .slice(1)
        .filter((currentRow) => currentRow.some((cell) => String(cell || '').trim() !== ''))
        .map((currentRow, rowIndex) => {
            const currentObject = { __rowNumber: rowIndex + 2 };
            headers.forEach((header, columnIndex) => {
                currentObject[header] = currentRow[columnIndex] ?? '';
            });
            return currentObject;
        });
}

function getCsvCell(row, key) {
    return String(row?.[key] ?? '').trim();
}

function parseCsvBoolean(value) {
    return ['true', '1', 'yes', 'y'].includes(String(value || '').trim().toLowerCase());
}

function parseCsvNumber(value, integer = false) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return null;
    const parsed = integer ? parseInt(normalized, 10) : Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseCsvDate(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return null;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveCategoryIdFromCsvRow(row) {
    const categoryId = getCsvCell(row, 'categoryId');
    if (categoryId) return categoryId;
    const categoryName = getCsvCell(row, 'categoryName').toLowerCase();
    if (!categoryName) return null;
    const match = getCategories().find((category) => String(category.name || '').trim().toLowerCase() === categoryName);
    return match?.id || null;
}

function parseVariationsFromCsvRow(row) {
    const rawValue = getCsvCell(row, 'variations');
    if (!rawValue) return [];
    try {
        const parsed = JSON.parse(rawValue);
        if (!Array.isArray(parsed)) throw new Error('not-array');
        return parsed.map((variation) => ({
            label: String(variation?.label || '').trim(),
            sku: String(variation?.sku || '').trim(),
            wholesalePrice: parseCsvNumber(variation?.wholesalePrice),
            retailPrice: parseCsvNumber(variation?.retailPrice),
            moq: parseCsvNumber(variation?.moq, true),
        }));
    } catch {
        throw new Error(`Row ${row.__rowNumber}: invalid variations JSON.`);
    }
}

function buildImportedImageFields(row) {
    const imageUrl = getCsvCell(row, 'imageUrl');
    const editedImageUrl = getCsvCell(row, 'editedImageUrl');
    const originalImageUrl = getCsvCell(row, 'originalImageUrl') || imageUrl || getCsvCell(row, 'currentImageUrl') || editedImageUrl || '';
    const currentImageUrl = getCsvCell(row, 'currentImageUrl') || editedImageUrl || imageUrl || originalImageUrl || '';
    const primaryImageUrl = imageUrl || currentImageUrl || originalImageUrl || '';
    return {
        imageUrl: primaryImageUrl,
        originalImageUrl,
        currentImageUrl,
        editedImageUrl,
        imageStatus: getCsvCell(row, 'imageStatus') || (editedImageUrl ? 'edited' : 'raw'),
    };
}

function buildProductPayloadFromCsvRow(row) {
    const hasVariations = parseCsvBoolean(row.hasVariations) || Boolean(getCsvCell(row, 'variations'));
    const payload = {
        ...buildImportedImageFields(row),
        name: getCsvCell(row, 'name'),
        description: getCsvCell(row, 'description'),
        categoryId: resolveCategoryIdFromCsvRow(row),
        uploadedBy: getCsvCell(row, 'uploadedBy') || localUsername || 'unknown',
        editedBy: getCsvCell(row, 'editedBy') || null,
        editedAt: parseCsvDate(row.editedAt),
    };

    if (hasVariations) {
        const variations = parseVariationsFromCsvRow(row);
        if (variations.length === 0) throw new Error(`Row ${row.__rowNumber}: variations product needs at least one variation.`);
        return {
            ...payload,
            hasVariations: true,
            variations,
            sku: '',
            wholesalePrice: null,
            retailPrice: null,
            moq: null,
        };
    }

    return {
        ...payload,
        hasVariations: false,
        variations: [],
        sku: getCsvCell(row, 'sku'),
        wholesalePrice: parseCsvNumber(row.wholesalePrice),
        retailPrice: parseCsvNumber(row.retailPrice),
        moq: parseCsvNumber(row.moq, true),
    };
}

function pickCsvFile() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,text/csv';
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const [file] = input.files || [];
            input.remove();
            resolve(file || null);
        }, { once: true });
        document.body.appendChild(input);
        input.click();
    });
}

async function importProductsCsv() {
    const file = await pickCsvFile();
    if (!file) return;

    try {
        const rows = parseCsvText(await file.text());
        if (rows.length === 0) {
            setStatus(t('csvNoRows'));
            showMsg(t('csvNoRows'), 'error');
            return;
        }

        const ok = await win95Confirm(t('menuImportCsv'), `${t('csvImportConfirm')}\n\n${file.name}\n${rows.length} rows`);
        if (!ok) return;

        setStatus(t('csvImporting'));
        showMsg(t('csvImporting'), 'info');

        let importedCount = 0;
        for (const row of rows) {
            const payload = buildProductPayloadFromCsvRow(row);
            const rowId = getCsvCell(row, 'id');
            if (rowId) {
                const exists = Boolean(getProductById(rowId));
                await setDoc(doc(db, 'products', rowId), {
                    ...payload,
                    ...(exists ? {} : { createdAt: serverTimestamp() }),
                }, { merge: true });
            } else {
                await addDoc(collection(db, 'products'), {
                    ...payload,
                    createdAt: serverTimestamp(),
                });
            }
            importedCount += 1;
        }

        const successMessage = `${t('csvImportDone')} (${importedCount})`;
        setStatus(successMessage);
        showMsg(successMessage, 'success');
    } catch (err) {
        console.error('[CSV Import]', err);
        const errorMessage = `${t('csvImportFailed')} ${err.message}`;
        setStatus(errorMessage);
        showMsg(errorMessage, 'error');
    }
}

function buildImageMetaText(product) {
    if (getImageStatus(product) !== 'edited') return t('imageNeverEdited');
    const parts = [t('imageStatusEdited')];
    if (product.editedBy) parts.push(`${t('imageEditedBy')} ${product.editedBy}`);
    const editedAt = formatTimestamp(product.editedAt);
    if (editedAt) parts.push(editedAt);
    return parts.join(' | ');
}

function slugifyPathSegment(value, fallback = 'uncategorized') {
    const cleaned = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return cleaned || fallback;
}

function buildManifestCsv(products) {
    const headers = ['id', 'name', 'category', 'sku', 'originalImageUrl', 'imageStatus'];
    const lines = [headers.join(',')];
    products.forEach(({ id, data }) => {
        const row = {
            id,
            name: data.name || '',
            category: getCategoryName(data.categoryId) || '',
            sku: data.sku || '',
            originalImageUrl: getOriginalImageUrl(data),
            imageStatus: getImageStatus(data),
        };
        lines.push(headers.map((header) => toCsvSafeValue(row[header])).join(','));
    });
    return `\uFEFF${lines.join('\r\n')}`;
}

function updateBulkDownloadButtonState() {
    if (!btnDownloadFilteredOriginals) return;
    const isDesignerMode = currentAppMode === 'designer';
    btnDownloadFilteredOriginals.style.display = isDesignerMode ? '' : 'none';
    btnDownloadFilteredOriginals.disabled = bulkDownloadInProgress || !isDesignerMode || filteredProducts.length === 0;
    btnDownloadFilteredOriginals.textContent = bulkDownloadInProgress ? t('downloadingFilteredOriginals') : t('btnDownloadFilteredOriginals');
}

async function downloadFilteredOriginalsZip() {
    if (bulkDownloadInProgress || filteredProducts.length === 0) return;
    bulkDownloadInProgress = true;
    updateBulkDownloadButtonState();

    try {
        const selectedProducts = [...filteredProducts];
        const JSZip = await getZipLibrary();
        const zip = new JSZip();
        zip.file('manifest.csv', buildManifestCsv(selectedProducts));

        const total = selectedProducts.length;
        for (let index = 0; index < total; index += 1) {
            const product = selectedProducts[index];
            const originalImageUrl = getOriginalImageUrl(product.data);
            const response = await fetch(originalImageUrl);
            if (!response.ok) throw new Error(`Failed to fetch image ${index + 1} of ${total} (HTTP ${response.status})`);
            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const categoryName = getCategoryName(product.data.categoryId) || 'uncategorized';
            const folderName = slugifyPathSegment(categoryName, 'uncategorized');
            const fileName = `${String(index + 1).padStart(3, '0')}-${sanitizeFilename(product.data.name || 'product')}-${product.id}${guessExtension(originalImageUrl, blob.type)}`;
            zip.folder(folderName).file(fileName, arrayBuffer);
            const progressMessage = `${t('downloadingFilteredOriginals')} ${index + 1}/${total}`;
            setStatus(progressMessage);
            showMsg(progressMessage, 'info');
        }

        setStatus(t('buildingZip'));
        showMsg(t('buildingZip'), 'info');
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadTextFile(`filtered-originals-${new Date().toISOString().slice(0, 10)}.zip`, zipBlob, 'application/zip');
        setStatus(`${t('filteredOriginalsDownloaded')} (${selectedProducts.length})`);
        showMsg(`${t('filteredOriginalsDownloaded')} (${selectedProducts.length})`, 'success');
    } catch (err) {
        console.error('[Bulk Original Download]', err);
        const message = `${t('filteredOriginalsDownloadFailed')} ${err.message}`;
        setStatus(message);
        showMsg(message, 'error');
    } finally {
        bulkDownloadInProgress = false;
        updateBulkDownloadButtonState();
    }
}

function closeImageViewer() {
    document.querySelector('.image-viewer-overlay')?.remove();
}

function openImageViewer(imageUrl, title = '') {
    if (!imageUrl) return;
    closeImageViewer();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay image-viewer-overlay';
    overlay.innerHTML = `
        <div class="image-viewer-dialog">
            <div class="login-title-bar image-viewer-titlebar">
                <span>${title || t('editTitle')}</span>
                <button type="button" class="title-btn image-viewer-close">\u2715</button>
            </div>
            <div class="image-viewer-body">
                <img class="image-viewer-img" src="${imageUrl}" alt="${title || 'Product image'}">
            </div>
        </div>
    `;
    overlay.querySelector('.image-viewer-close').addEventListener('click', closeImageViewer);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeImageViewer();
    });
    document.body.appendChild(overlay);
}

function updateImageStatusFilterOptions() {
    if (!searchImageStatus) return;
    const currentValue = searchImageStatus.value;
    searchImageStatus.innerHTML = `
        <option value="">${t('searchAllImages')}</option>
        <option value="raw">${t('searchRawOnly')}</option>
        <option value="edited">${t('searchEditedOnly')}</option>
    `;
    searchImageStatus.value = currentValue || '';
}

function updateMissingDetailFilterOptions() {
    if (!searchMissingDetail) return;
    const currentValue = searchMissingDetail.value;
    searchMissingDetail.innerHTML = `
        <option value="">${t('searchAllDetails')}</option>
        <option value="incomplete">${t('searchIncompleteOnly')}</option>
        <option value="name">${t('searchNoName')}</option>
        <option value="sku">${t('searchNoSku')}</option>
        <option value="price">${t('searchNoPrice')}</option>
        <option value="description">${t('searchNoDescription')}</option>
    `;
    searchMissingDetail.value = currentValue || '';
}

function syncModeUi({ rerender = true, suppressStatus = false } = {}) {
    if (currentAppMode === 'designer' && !canUseDesignerMode()) currentAppMode = 'catalog';
    document.body.classList.toggle('designer-mode', currentAppMode === 'designer');
    if (contentArea) contentArea.classList.toggle('designer-mode', currentAppMode === 'designer');
    if (modeSwitcher) modeSwitcher.style.display = canUseDesignerMode() ? 'flex' : 'none';
    if (btnModeCatalog) btnModeCatalog.classList.toggle('active', currentAppMode === 'catalog');
    if (btnModeDesigner) btnModeDesigner.classList.toggle('active', currentAppMode === 'designer');
    if (designerBanner) designerBanner.style.display = currentAppMode === 'designer' ? '' : 'none';
    if (sectionDb) sectionDb.textContent = currentAppMode === 'designer' ? t('sectionDesigner') : t('sectionDb');
    if (!suppressStatus && mainWindow.style.display === 'block') {
        setStatus(currentAppMode === 'designer' ? t('designerReady') : `${t('loggedInAs')} ${localUsername || ''}`);
    }
    updateBulkDownloadButtonState();
    if (rerender) setProducts(allProducts);
}

function showUnlockedUi() {
    loginScreen.classList.add('hidden');
    mainWindow.style.display = 'block';
    userName.textContent = localUsername || '\u2014';
    currentAppMode = getDefaultModeForRole();
    applyLanguage(localStorage.getItem('lang') || 'en');
    syncModeUi({ rerender: false });
}

function updatePinPadDisplay(displayEl, value) {
    displayEl.textContent = value ? '\u25CF'.repeat(value.length) : '\u00A0';
}

function promptDesignerPin() {
    return new Promise((resolve) => {
        let enteredPin = '';

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="login-dialog" style="width:280px;">
                <div class="login-title-bar">
                    <span>${t('designerPinTitle')}</span>
                    <button class="title-btn pin-pad-close">\u2715</button>
                </div>
                <div class="pin-pad-body">
                    <div class="pin-pad-prompt">${t('designerPinPrompt')}</div>
                    <div class="pin-pad-display" id="pin-pad-display">&nbsp;</div>
                    <div class="pin-pad-error" id="pin-pad-error"></div>
                    <div class="pin-pad-grid">
                        <button type="button" class="pin-pad-key" data-pin-value="1">1</button>
                        <button type="button" class="pin-pad-key" data-pin-value="2">2</button>
                        <button type="button" class="pin-pad-key" data-pin-value="3">3</button>
                        <button type="button" class="pin-pad-key" data-pin-value="4">4</button>
                        <button type="button" class="pin-pad-key" data-pin-value="5">5</button>
                        <button type="button" class="pin-pad-key" data-pin-value="6">6</button>
                        <button type="button" class="pin-pad-key" data-pin-value="7">7</button>
                        <button type="button" class="pin-pad-key" data-pin-value="8">8</button>
                        <button type="button" class="pin-pad-key" data-pin-value="9">9</button>
                        <button type="button" class="pin-pad-key" data-pin-action="clear">${t('btnClear')}</button>
                        <button type="button" class="pin-pad-key" data-pin-value="0">0</button>
                        <button type="button" class="pin-pad-key" data-pin-action="back">${t('pinBack')}</button>
                    </div>
                    <div class="pin-pad-actions">
                        <button type="button" class="btn pin-pad-cancel">${t('btnCancel')}</button>
                        <button type="button" class="btn pin-pad-submit">${t('designerPinUnlock')}</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const displayEl = overlay.querySelector('#pin-pad-display');
        const errorEl = overlay.querySelector('#pin-pad-error');

        const close = (result) => {
            document.removeEventListener('keydown', handleKeydown);
            overlay.remove();
            resolve(result);
        };

        const submit = () => {
            if (enteredPin === DESIGNER_PIN) {
                close(true);
                return;
            }
            enteredPin = '';
            updatePinPadDisplay(displayEl, enteredPin);
            errorEl.textContent = t('designerPinInvalid');
        };

        const pushDigit = (digit) => {
            if (enteredPin.length >= 4) return;
            enteredPin += digit;
            errorEl.textContent = '';
            updatePinPadDisplay(displayEl, enteredPin);
            if (enteredPin.length === 4) submit();
        };

        const handleKeydown = (event) => {
            if (/^\d$/.test(event.key)) {
                event.preventDefault();
                pushDigit(event.key);
            } else if (event.key === 'Backspace') {
                event.preventDefault();
                enteredPin = enteredPin.slice(0, -1);
                errorEl.textContent = '';
                updatePinPadDisplay(displayEl, enteredPin);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                close(false);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                submit();
            }
        };

        overlay.querySelectorAll('.pin-pad-key').forEach((button) => {
            button.addEventListener('click', () => {
                const digit = button.dataset.pinValue;
                const action = button.dataset.pinAction;
                if (digit) {
                    pushDigit(digit);
                    return;
                }
                if (action === 'clear') {
                    enteredPin = '';
                } else if (action === 'back') {
                    enteredPin = enteredPin.slice(0, -1);
                }
                errorEl.textContent = '';
                updatePinPadDisplay(displayEl, enteredPin);
            });
        });

        overlay.querySelector('.pin-pad-close').addEventListener('click', () => close(false));
        overlay.querySelector('.pin-pad-cancel').addEventListener('click', () => close(false));
        overlay.querySelector('.pin-pad-submit').addEventListener('click', submit);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close(false);
        });
        document.addEventListener('keydown', handleKeydown);
        updatePinPadDisplay(displayEl, enteredPin);
    });
}

async function ensureDesignerModeUnlocked() {
    if (!canUseDesignerMode()) return false;
    if (designerPinUnlocked) return true;
    const unlocked = await promptDesignerPin();
    if (unlocked) {
        designerPinUnlocked = true;
        setStatus(t('designerUnlocked'));
    }
    return unlocked;
}

async function setAppMode(mode) {
    const previousMode = currentAppMode;

    if (mode === 'designer') {
        if (!canUseDesignerMode()) {
            currentAppMode = 'catalog';
        } else {
            const unlocked = await ensureDesignerModeUnlocked();
            if (!unlocked) return;
            currentAppMode = 'designer';
        }
    } else {
        currentAppMode = 'catalog';
        showCategoryPanel();
    }

    if (previousMode === 'designer' && currentAppMode !== 'designer' && searchImageStatus) searchImageStatus.value = '';
    hideReports();
    syncModeUi();
    refreshOpenEditImagePanel();
}

function updateDropPreview(file) {
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = (event) => {
        const existing = dropZone.querySelector('img');
        if (existing) existing.remove();
        dropHint.style.display = 'none';
        const img = document.createElement('img');
        img.src = event.target.result;
        img.alt = file.name;
        dropZone.appendChild(img);
    };
    reader.readAsDataURL(file);
    setStatus(`${file.name} (${formatBytes(file.size)})`);
}

function buildDesignerCountLabel(products) {
    const rawCount = products.filter((entry) => getImageStatus(entry.data) === 'raw').length;
    const editedCount = products.filter((entry) => getImageStatus(entry.data) === 'edited').length;
    return `(${products.length}) ${t('imageStatusRaw')}: ${rawCount} | ${t('imageStatusEdited')}: ${editedCount}`;
}

function refreshOpenEditImagePanel() {
    if (!editingDocId || editOverlay.style.display !== 'flex') return;
    const product = getProductById(editingDocId);
    if (!product) {
        closeEditModal();
        return;
    }
    refreshEditImagePanel(product.data);
}

async function uploadImageFile(file, folder, onProgress) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_PRESET);
        if (folder) formData.append('folder', folder);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`);
        xhr.upload.addEventListener('progress', (event) => {
            if (onProgress && event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
        });
        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(JSON.parse(xhr.responseText).secure_url);
                return;
            }
            reject(new Error(`Cloudinary error: ${xhr.status} ${xhr.statusText}`));
        });
        xhr.addEventListener('error', () => reject(new Error('Network error during upload.')));
        xhr.send(formData);
    });
}

async function downloadImage(url, productName, suffix) {
    if (!url) return;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${sanitizeFilename(productName)}-${suffix}${guessExtension(url, blob.type)}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
    } catch (err) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
    }
}

async function handleEditedImageSelection(productId, file) {
    if (!file || !file.type.startsWith('image/')) {
        showMsg(t('noImage'), 'error');
        return;
    }
    const productRecord = getProductById(productId);
    if (!productRecord || uploadingImageIds.has(productId)) return;
    uploadingImageIds.add(productId);
    setStatus(t('uploadingEditedImage'));
    showMsg(t('uploadingEditedImage'), 'info');
    setProducts(allProducts);
    refreshOpenEditImagePanel();
    try {
        const editedUrl = await uploadImageFile(file, 'products/edited');
        await updateDoc(doc(db, 'products', productId), {
            originalImageUrl: getOriginalImageUrl(productRecord.data),
            editedImageUrl: editedUrl,
            currentImageUrl: editedUrl,
            imageUrl: editedUrl,
            imageStatus: 'edited',
            editedBy: localUsername || 'unknown',
            editedAt: serverTimestamp(),
        });
        setStatus(t('imageUpdated'));
        showMsg(t('imageUpdated'), 'success');
    } catch (err) {
        console.error('[Edited Image Upload]', err);
        setStatus('Image upload failed.');
        showMsg(`Error: ${err.message}`, 'error');
    } finally {
        uploadingImageIds.delete(productId);
        setProducts(allProducts);
        refreshOpenEditImagePanel();
    }
}

async function deleteEditedImage(productId) {
    const productRecord = getProductById(productId);
    if (!productRecord) return;
    const originalImageUrl = getOriginalImageUrl(productRecord.data);
    const editedImageUrl = getEditedImageUrl(productRecord.data);
    if (!editedImageUrl) return;
    const ok = await win95Confirm(t('btnDeleteEdited'), `${t('deleteEditedConfirm')}\n\n"${productRecord.data.name || 'product'}"`);
    if (!ok) return;
    try {
        await updateDoc(doc(db, 'products', productId), {
            originalImageUrl,
            editedImageUrl: null,
            currentImageUrl: originalImageUrl,
            imageUrl: originalImageUrl,
            imageStatus: 'raw',
            editedBy: null,
            editedAt: null,
        });
        setStatus(t('imageDeleted'));
        showMsg(t('imageDeleted'), 'success');
    } catch (err) {
        console.error('[Edited Image Delete]', err);
        showMsg(`Error: ${err.message}`, 'error');
        setStatus('Image delete failed.');
    } finally {
        refreshOpenEditImagePanel();
    }
}

function bindDesignerImageInput(uploadInput, productId) {
    uploadInput.addEventListener('change', async () => {
        const file = uploadInput.files[0];
        uploadInput.value = '';
        if (file) await handleEditedImageSelection(productId, file);
    });
}

function bindDesignerDropTarget(dropTarget, productId) {
    ['dragenter', 'dragover'].forEach((eventName) => {
        dropTarget.addEventListener(eventName, (event) => {
            if (uploadingImageIds.has(productId)) return;
            event.preventDefault();
            dropTarget.classList.add('dragover');
        });
    });
    ['dragleave', 'dragend'].forEach((eventName) => {
        dropTarget.addEventListener(eventName, () => dropTarget.classList.remove('dragover'));
    });
    dropTarget.addEventListener('drop', async (event) => {
        event.preventDefault();
        dropTarget.classList.remove('dragover');
        if (uploadingImageIds.has(productId)) return;
        await handleEditedImageSelection(productId, event.dataTransfer?.files?.[0]);
    });
}

function refreshEditImagePanel(product) {
    const originalImageUrl = getOriginalImageUrl(product);
    const currentImageUrl = getCurrentImageUrl(product);
    const editedImageUrl = getEditedImageUrl(product);
    editOriginalPreview.src = originalImageUrl || placeholderSvg();
    editCurrentPreview.src = currentImageUrl || placeholderSvg();
    editOriginalPreview.dataset.viewerUrl = originalImageUrl;
    editCurrentPreview.dataset.viewerUrl = currentImageUrl;
    editOriginalPreview.dataset.viewerTitle = t('imageOriginal');
    editCurrentPreview.dataset.viewerTitle = t('imageCurrent');
    editImageStatusLabel.textContent = t(getImageStatusKey(product));
    editImageStatusLabel.className = `edit-image-status is-${getImageStatus(product)}`;
    const parts = [buildImageMetaText(product)];
    if (uploadingImageIds.has(editingDocId)) parts.push(t('uploadingEditedImage'));
    editImageMeta.textContent = parts.join(' | ');
    btnEditDownloadOriginal.disabled = !originalImageUrl;
    btnEditDownloadEdited.disabled = !editedImageUrl;
    btnEditUploadImage.disabled = uploadingImageIds.has(editingDocId);
    btnEditDeleteEdited.disabled = !editedImageUrl || uploadingImageIds.has(editingDocId);
}

function applyLanguage(lang) {
    setLang(lang);
    localStorage.setItem('lang', lang);
    document.body.classList.toggle('rtl', lang === 'ar');
    document.documentElement.lang = lang;
    document.querySelectorAll('.lang-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.lang === lang);
    });
    const map = {
        't-login-titlebar': 'loginTitleBar',
        't-login-title': 'loginTitle',
        't-login-subtitle': 'loginSubtitle',
        't-label-username': 'labelUsername',
        't-label-password': 'labelPassword',
        'btn-login': 'btnLogin',
        'btn-mode-catalog': 'modeCatalog',
        'btn-mode-designer': 'modeDesigner',
        't-section-add': 'sectionAdd',
        't-drag-drop': 'dragDrop',
        't-or-browse': 'orBrowse',
        't-label-name': 'labelName',
        't-label-sku': 'labelSku',
        't-label-ws': 'labelWs',
        't-label-retail': 'labelRetail',
        't-label-moq': 'labelMoq',
        't-label-desc': 'labelDesc',
        't-label-category': 'labelCategory',
        'btn-clear': 'btnClear',
        'btn-save': 'btnSave',
        't-section-db': 'sectionDb',
        't-designer-banner-title': 'designerBannerTitle',
        't-designer-banner-body': 'designerBannerBody',
        't-search-category': 'searchCategory',
        't-search-image-status': 'searchImageStatus',
        't-search-missing-detail': 'searchMissingDetail',
        't-search-min': 'searchPriceMin',
        't-search-max': 'searchPriceMax',
        'btn-download-filtered-originals': 'btnDownloadFilteredOriginals',
        'btn-signout': 'btnSignout',
        't-edit-title': 'editTitle',
        'btn-edit-download-original': 'btnDownloadOriginal',
        'btn-edit-download-edited': 'btnDownloadEdited',
        'btn-edit-upload-image': 'btnUploadEdited',
        'btn-edit-delete-edited': 'btnDeleteEdited',
        't-image-original': 'imageOriginal',
        't-image-current': 'imageCurrent',
        't-edit-label-name': 'editLabelName',
        't-edit-label-sku': 'editLabelSku',
        't-edit-label-ws': 'editLabelWs',
        't-edit-label-retail': 'editLabelRetail',
        't-edit-label-moq': 'editLabelMoq',
        't-edit-label-desc': 'editLabelDesc',
        't-edit-label-category': 'editLabelCategory',
        'btn-edit-cancel': 'btnCancel',
        'btn-edit-save': 'btnSaveChanges',
        'tab-simple': 'btnSimple',
        'tab-variations': 'btnVariations',
        't-var-col-label': 'varColLabel',
        't-var-col-sku': 'varColSku',
        't-var-col-ws': 'varColWs',
        't-var-col-retail': 'varColRetail',
        't-var-col-moq': 'varColMoq',
        'btn-add-row': 'btnAddRow',
        't-evar-col-label': 'varColLabel',
        't-evar-col-sku': 'varColSku',
        't-evar-col-ws': 'varColWs',
        't-evar-col-retail': 'varColRetail',
        't-evar-col-moq': 'varColMoq',
        'btn-edit-add-row': 'btnAddRow',
        'menu-file': 'menuFile',
        'menu-edit': 'menuEdit',
        'menu-view': 'menuView',
        'menu-help': 'menuHelp',
        'search-clear': 'searchClearFilters',
        'cat-panel-title': 'catManager',
        'btn-cat-new': 'catNewCategory',
        'report-title': 'reportTitle',
        'btn-back-catalog': 'reportBackToCatalog',
    };
    Object.entries(map).forEach(([id, key]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = t(key);
    });
    const searchText = document.getElementById('search-text');
    if (searchText) searchText.placeholder = t('searchPlaceholder');
    updateImageStatusFilterOptions();
    updateMissingDetailFilterOptions();
    populateCategoryDropdowns();
    updateSearchCategories(getCategories());
    syncModeUi({ rerender: true, suppressStatus: true });
    refreshOpenEditImagePanel();
}

document.querySelectorAll('.lang-btn').forEach((button) => {
    button.addEventListener('click', () => applyLanguage(button.dataset.lang));
});

function switchFormMode(mode) {
    formMode = mode;
    document.getElementById('simple-fields').style.display = mode === 'simple' ? '' : 'none';
    document.getElementById('variations-fields').style.display = mode === 'variations' ? '' : 'none';
    document.querySelectorAll('.mode-tab').forEach((button) => {
        button.classList.toggle('active', button.dataset.mode === mode);
    });
    if (mode === 'variations' && document.getElementById('var-body').rows.length === 0) {
        addVariationRow('var-body');
        addVariationRow('var-body');
    }
}

document.querySelectorAll('.mode-tab').forEach((button) => {
    button.addEventListener('click', () => switchFormMode(button.dataset.mode));
});

function addVariationRow(tbodyId) {
    const tbody = document.getElementById(tbodyId);
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><input type="text" class="v-label" placeholder="e.g. S / Red" maxlength="40"></td>
        <td><input type="text" class="v-sku" maxlength="40"></td>
        <td><input type="number" class="v-ws" min="0" step="1"></td>
        <td><input type="number" class="v-retail" min="0" step="1"></td>
        <td><input type="number" class="v-moq" min="1" step="1"></td>
        <td><button type="button" class="var-remove-btn" title="Remove">\u2715</button></td>`;
    row.querySelector('.var-remove-btn').addEventListener('click', () => row.remove());
    tbody.appendChild(row);
}

function getVariationsFromBody(tbodyId) {
    const rows = document.getElementById(tbodyId).rows;
    const result = [];
    for (const row of rows) {
        result.push({
            label: row.querySelector('.v-label').value.trim(),
            sku: row.querySelector('.v-sku').value.trim() || '',
            wholesalePrice: row.querySelector('.v-ws').value ? parseFloat(row.querySelector('.v-ws').value) : null,
            retailPrice: row.querySelector('.v-retail').value ? parseFloat(row.querySelector('.v-retail').value) : null,
            moq: row.querySelector('.v-moq').value ? parseInt(row.querySelector('.v-moq').value, 10) : null,
        });
    }
    return result;
}

document.getElementById('btn-add-row').addEventListener('click', () => addVariationRow('var-body'));
document.getElementById('btn-edit-add-row').addEventListener('click', () => addVariationRow('edit-var-body'));

onAuthStateChanged(auth, (user) => {
    if (user && localUsername) {
        btnLogin.disabled = false;
        btnLogin.textContent = t('btnLogin');
        showUnlockedUi();
        if (!unsubscribeFirestore) startFirestoreListener();
        startCategoriesListener();
        setStatus(`${t('loggedInAs')} ${localUsername}`);
        return;
    }
    mainWindow.style.display = 'none';
    loginScreen.classList.remove('hidden');
    btnLogin.disabled = false;
    btnLogin.textContent = t('btnLogin');
    if (unsubscribeFirestore) {
        unsubscribeFirestore();
        unsubscribeFirestore = null;
    }
    stopCategoriesListener();
    userName.textContent = '\u2014';
    designerPinUnlocked = false;
    currentUserRole = 'viewer';
    currentAppMode = 'catalog';
    syncModeUi({ rerender: false, suppressStatus: true });
});

loginPassword.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') btnLogin.click();
});
loginUsername.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loginPassword.focus();
});

btnLogin.addEventListener('click', async () => {
    loginError.textContent = '';
    const username = loginUsername.value.trim();
    const password = loginPassword.value;
    if (!username) return void (loginError.textContent = t('enterUsername'));
    if (!password) return void (loginError.textContent = t('enterPassword'));
    const match = LOCAL_USERS.find((user) => user.username === username && user.password === password);
    if (!match) return void (loginError.textContent = t('invalidCreds'));
    btnLogin.disabled = true;
    btnLogin.textContent = t('loggingIn');
    try {
        localUsername = username;
        currentUserRole = match.role || 'admin';
        designerPinUnlocked = false;
        await signInAnonymously(auth);
        showUnlockedUi();
        if (!unsubscribeFirestore) startFirestoreListener();
        startCategoriesListener();
        setStatus(`${t('loggedInAs')} ${localUsername}`);
        btnLogin.disabled = false;
        btnLogin.textContent = t('btnLogin');
    } catch (err) {
        localUsername = null;
        currentUserRole = 'viewer';
        loginError.textContent = `${t('connectError')} ${err.message}`;
        btnLogin.disabled = false;
        btnLogin.textContent = t('btnLogin');
    }
});

btnSignout.addEventListener('click', async () => {
    const ok = await win95Confirm(t('btnSignout'), t('signoutConfirm'));
    if (!ok) return;
    clearForm();
    hideReports();
    closeEditModal();
    designerPinUnlocked = false;
    localUsername = null;
    currentUserRole = 'viewer';
    await signOut(auth);
});

function startFirestoreListener() {
    const productsQuery = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
    unsubscribeFirestore = onSnapshot(
        productsQuery,
        (snapshot) => {
            statusDb.textContent = '\uD83D\uDFE2 Connected';
            allProducts = [];
            snapshot.forEach((docSnap) => allProducts.push({ id: docSnap.id, data: docSnap.data() }));
            setProducts(allProducts);
            refreshOpenEditImagePanel();
        },
        (err) => {
            statusDb.textContent = '\uD83D\uDD34 Error';
            galleryGrid.innerHTML = '';
            const message = document.createElement('div');
            message.className = 'gallery-empty';
            message.style.color = '#cc0000';
            message.textContent = `Database error: ${err.message}`;
            galleryGrid.appendChild(message);
        }
    );
}

function renderFilteredGallery(products) {
    filteredProducts = products;
    updateBulkDownloadButtonState();
    productCount.textContent = currentAppMode === 'designer' ? buildDesignerCountLabel(products) : `(${products.length})`;
    galleryGrid.innerHTML = '';
    if (products.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'gallery-empty';
        empty.textContent = t('noProducts');
        galleryGrid.appendChild(empty);
        return;
    }
    const sorted = [...products];
    if (currentSort === 'name') sorted.sort((a, b) => (a.data.name || '').localeCompare(b.data.name || ''));
    if (currentSort === 'price') {
        const getPrice = (product) => {
            if (product.data.hasVariations && Array.isArray(product.data.variations) && product.data.variations.length > 0) {
                const prices = product.data.variations.map((variation) => variation.wholesalePrice).filter((value) => value != null);
                return prices.length > 0 ? Math.min(...prices) : Infinity;
            }
            return product.data.wholesalePrice != null ? product.data.wholesalePrice : Infinity;
        };
        sorted.sort((a, b) => getPrice(a) - getPrice(b));
    }
    sorted.forEach((product) => galleryGrid.appendChild(buildCard(product.data, product.id)));
    if (isReportVisible()) renderReports(allProducts);
}

onFilterChange(renderFilteredGallery);

function buildCard(product, productId) {
    const card = document.createElement('div');
    card.className = 'product-card';
    const isDesignerMode = currentAppMode === 'designer';
    const isUploading = uploadingImageIds.has(productId);
    const currentImageUrl = getCurrentImageUrl(product);
    const originalImageUrl = getOriginalImageUrl(product);
    const editedImageUrl = getEditedImageUrl(product);

    const imageShell = document.createElement('div');
    imageShell.className = 'card-image-shell';
    if (isDesignerMode) imageShell.classList.add('designer-drop-target');

    const img = document.createElement('img');
    img.alt = product.name || '';
    img.loading = 'lazy';
    img.src = currentImageUrl || placeholderSvg();
    img.addEventListener('error', () => { img.src = placeholderSvg(); });

    const imageBadge = document.createElement('div');
    imageBadge.className = `card-image-status is-${getImageStatus(product)}`;
    imageBadge.textContent = t(getImageStatusKey(product));
    imageShell.append(img, imageBadge);

    const uploadInput = document.createElement('input');
    uploadInput.type = 'file';
    uploadInput.accept = 'image/*';
    uploadInput.style.display = 'none';
    bindDesignerImageInput(uploadInput, productId);

    if (isDesignerMode) {
        const dropHintEl = document.createElement('div');
        dropHintEl.className = 'card-drop-hint';
        dropHintEl.textContent = t('imageDropHint');
        imageShell.append(dropHintEl);
        bindDesignerDropTarget(imageShell, productId);
    }

    const info = document.createElement('div');
    info.className = 'card-info';
    const name = document.createElement('div');
    name.className = 'card-name';
    name.title = product.name || '';
    name.textContent = product.name || '(unnamed)';
    info.append(name);

    if (product.categoryId) {
        const categoryName = getCategoryName(product.categoryId);
        if (categoryName) {
            const categoryBadge = document.createElement('div');
            categoryBadge.className = 'card-cat-badge';
            categoryBadge.textContent = categoryName;
            info.append(categoryBadge);
        }
    }

    if (product.hasVariations && Array.isArray(product.variations) && product.variations.length > 0) {
        const badge = document.createElement('div');
        badge.className = 'card-var-badge';
        badge.textContent = t('variationsBadge');
        const variationList = document.createElement('div');
        variationList.className = 'card-variations';
        product.variations.slice(0, 3).forEach((variation) => {
            const row = document.createElement('div');
            row.className = 'card-var-row';
            const label = document.createElement('span');
            label.className = 'card-var-label';
            label.textContent = variation.label || '\u2014';
            const price = document.createElement('span');
            price.className = 'card-var-price';
            price.textContent = variation.wholesalePrice != null ? `${Number(variation.wholesalePrice).toLocaleString()} ${t('currency')}` : '\u2014';
            row.append(label, price);
            variationList.appendChild(row);
        });
        if (product.variations.length > 3) {
            const more = document.createElement('div');
            more.className = 'card-var-more';
            more.textContent = `+${product.variations.length - 3} more`;
            variationList.appendChild(more);
        }
        info.append(badge, variationList);
    } else {
        const sku = document.createElement('div');
        sku.className = 'card-sku';
        sku.textContent = product.sku || '';
        const ws = document.createElement('div');
        ws.className = 'card-ws';
        ws.textContent = product.wholesalePrice != null ? `${Number(product.wholesalePrice).toLocaleString()} ${t('currency')}` : '\u2014';
        const moq = document.createElement('div');
        moq.className = 'card-moq';
        moq.textContent = product.moq != null ? `${t('moqLabel')} ${product.moq}` : '';
        info.append(sku, ws, moq);
    }

    if (isDesignerMode) {
        const meta = document.createElement('div');
        meta.className = 'card-image-meta';
        meta.textContent = buildImageMetaText(product);
        info.append(meta);
        if (isUploading) {
            const uploadingNote = document.createElement('div');
            uploadingNote.className = 'card-uploading-note';
            uploadingNote.textContent = t('uploadingEditedImage');
            info.append(uploadingNote);
        }
    }

    const buttons = document.createElement('div');
    buttons.className = 'card-btns';
    if (isDesignerMode) {
        buttons.classList.add('designer-card-btns');
        const previewBtn = document.createElement('button');
        previewBtn.className = 'card-btn card-btn-secondary';
        previewBtn.textContent = t('btnEdit');
        previewBtn.addEventListener('click', () => openEditModal(product, productId));
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'card-btn';
        downloadBtn.textContent = t('btnDownloadOriginal');
        downloadBtn.addEventListener('click', () => downloadImage(originalImageUrl, product.name || 'product', 'original'));
        const downloadEditedBtn = document.createElement('button');
        downloadEditedBtn.className = 'card-btn';
        downloadEditedBtn.textContent = t('btnDownloadEdited');
        downloadEditedBtn.disabled = !editedImageUrl;
        downloadEditedBtn.addEventListener('click', () => {
            if (!editedImageUrl) return;
            downloadImage(editedImageUrl, product.name || 'product', 'edited');
        });
        const uploadBtn = document.createElement('button');
        uploadBtn.className = 'card-btn';
        uploadBtn.textContent = t('btnUploadEdited');
        uploadBtn.disabled = isUploading;
        uploadBtn.addEventListener('click', () => uploadInput.click());
        buttons.append(previewBtn, downloadBtn, downloadEditedBtn, uploadBtn);
    } else {
        const editBtn = document.createElement('button');
        editBtn.className = 'card-btn';
        editBtn.textContent = t('btnEdit');
        editBtn.addEventListener('click', () => openEditModal(product, productId));
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'card-btn card-btn-delete';
        deleteBtn.textContent = t('btnDelete');
        deleteBtn.addEventListener('click', () => deleteProduct(productId, product.name));
        buttons.append(editBtn, deleteBtn);
    }

    info.append(buttons, uploadInput);
    card.append(imageShell, info);
    return card;
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', (event) => {
    if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) updateDropPreview(file);
    else showMsg(t('noImage'), 'error');
});
fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) updateDropPreview(fileInput.files[0]);
});

btnClear.addEventListener('click', clearForm);

function clearForm() {
    selectedFile = null;
    fileInput.value = '';
    fName.value = '';
    fSku.value = '';
    fWs.value = '';
    fRetail.value = '';
    fMoq.value = '';
    fDesc.value = '';
    if (fCat) fCat.value = '';
    const img = dropZone.querySelector('img');
    if (img) img.remove();
    dropHint.style.display = '';
    hideMsg();
    progressWrap.style.display = 'none';
    progressFill.style.width = '0%';
    document.getElementById('var-body').innerHTML = '';
    switchFormMode('simple');
    syncModeUi({ rerender: false });
}

btnSave.addEventListener('click', async () => {
    hideMsg();
    if (!selectedFile) return showMsg(t('noImage'), 'error');
    if (!fName.value.trim()) return showMsg(t('noName'), 'error');
    if (formMode === 'variations' && document.getElementById('var-body').rows.length === 0) {
        return showMsg(t('noVariations'), 'error');
    }
    btnSave.disabled = true;
    btnClear.disabled = true;
    progressWrap.style.display = 'block';
    progressFill.style.width = '0%';
    setStatus(t('uploadingImg'));
    showMsg(t('uploadingImg'), 'info');
    try {
        const imageUrl = await uploadImageFile(selectedFile, 'products/originals', (percent) => {
            progressFill.style.width = `${Math.round(percent * 0.8)}%`;
        });
        progressFill.style.width = '90%';
        setStatus(t('savingRecord'));
        showMsg(t('savingRecord'), 'info');
        const docData = {
            ...buildInitialImageFields(imageUrl),
            name: fName.value.trim(),
            description: fDesc.value.trim(),
            uploadedBy: localUsername || 'unknown',
            createdAt: serverTimestamp(),
            categoryId: fCat ? (fCat.value || null) : null,
        };
        if (formMode === 'variations') {
            docData.hasVariations = true;
            docData.variations = getVariationsFromBody('var-body');
        } else {
            docData.hasVariations = false;
            docData.sku = fSku.value.trim() || '';
            docData.wholesalePrice = fWs.value ? parseFloat(fWs.value) : null;
            docData.retailPrice = fRetail.value ? parseFloat(fRetail.value) : null;
            docData.moq = fMoq.value ? parseInt(fMoq.value, 10) : null;
        }
        await addDoc(collection(db, 'products'), docData);
        progressFill.style.width = '100%';
        showMsg(t('productSaved'), 'success');
        setStatus(t('productSaved'));
        clearForm();
    } catch (err) {
        console.error('[Save]', err);
        showMsg(`Error: ${err.message}`, 'error');
        setStatus('Save failed.');
    } finally {
        btnSave.disabled = false;
        btnClear.disabled = false;
        setTimeout(() => {
            progressWrap.style.display = 'none';
            progressFill.style.width = '0%';
        }, 2500);
    }
});

async function deleteProduct(productId, productName) {
    const ok = await win95Confirm(t('btnDelete'), `${t('deleteConfirm')}\n\n"${productName}"`);
    if (!ok) return;
    try {
        await deleteDoc(doc(db, 'products', productId));
        setStatus(t('productDeleted'));
    } catch (err) {
        console.error('[Delete]', err);
        alert(`Error: ${err.message}`);
    }
}

function openEditModal(product, productId) {
    editingDocId = productId;
    eName.value = product.name || '';
    eDesc.value = product.description || '';
    editError.textContent = '';
    if (eCat) eCat.value = product.categoryId || '';
    const editSimple = document.getElementById('edit-simple-fields');
    const editVariations = document.getElementById('edit-variations-fields');
    const editVarBody = document.getElementById('edit-var-body');
    if (product.hasVariations && Array.isArray(product.variations)) {
        editSimple.style.display = 'none';
        editVariations.style.display = '';
        editVarBody.innerHTML = '';
        product.variations.forEach((variation) => {
            addVariationRow('edit-var-body');
            const row = editVarBody.lastElementChild;
            row.querySelector('.v-label').value = variation.label || '';
            row.querySelector('.v-sku').value = variation.sku || '';
            row.querySelector('.v-ws').value = variation.wholesalePrice ?? '';
            row.querySelector('.v-retail').value = variation.retailPrice ?? '';
            row.querySelector('.v-moq').value = variation.moq ?? '';
        });
    } else {
        editSimple.style.display = '';
        editVariations.style.display = 'none';
        eSku.value = product.sku || '';
        eWs.value = product.wholesalePrice ?? '';
        eRetail.value = product.retailPrice ?? '';
        eMoq.value = product.moq ?? '';
    }
    refreshEditImagePanel(product);
    editOverlay.style.display = 'flex';
    eName.focus();
}

function closeEditModal() {
    editOverlay.style.display = 'none';
    editingDocId = null;
    editImageInput.value = '';
    closeImageViewer();
}

btnEditClose.addEventListener('click', closeEditModal);
btnEditCancel.addEventListener('click', closeEditModal);
editOverlay.addEventListener('click', (event) => {
    if (event.target === editOverlay) closeEditModal();
});
editOriginalPreview.addEventListener('click', () => openImageViewer(editOriginalPreview.dataset.viewerUrl, editOriginalPreview.dataset.viewerTitle));
editCurrentPreview.addEventListener('click', () => openImageViewer(editCurrentPreview.dataset.viewerUrl, editCurrentPreview.dataset.viewerTitle));

btnEditDownloadOriginal.addEventListener('click', async () => {
    if (!editingDocId) return;
    const product = getProductById(editingDocId);
    if (!product) return;
    await downloadImage(getOriginalImageUrl(product.data), product.data.name || 'product', 'original');
});

btnEditDownloadEdited.addEventListener('click', async () => {
    if (!editingDocId) return;
    const product = getProductById(editingDocId);
    if (!product) return;
    const editedImageUrl = getEditedImageUrl(product.data);
    if (!editedImageUrl) return;
    await downloadImage(editedImageUrl, product.data.name || 'product', 'edited');
});

btnEditUploadImage.addEventListener('click', () => {
    if (editingDocId) editImageInput.click();
});

btnEditDeleteEdited.addEventListener('click', async () => {
    if (!editingDocId) return;
    await deleteEditedImage(editingDocId);
});

if (btnDownloadFilteredOriginals) {
    btnDownloadFilteredOriginals.addEventListener('click', () => {
        downloadFilteredOriginalsZip();
    });
}

editImageInput.addEventListener('change', async () => {
    if (!editingDocId) return;
    const file = editImageInput.files[0];
    editImageInput.value = '';
    if (file) await handleEditedImageSelection(editingDocId, file);
});

btnEditSave.addEventListener('click', async () => {
    if (!editingDocId) return;
    editError.textContent = '';
    if (!eName.value.trim()) {
        editError.textContent = t('noName');
        return;
    }
    btnEditSave.disabled = true;
    btnEditSave.textContent = t('savingRecord');
    try {
        const isVariationMode = document.getElementById('edit-variations-fields').style.display !== 'none';
        const update = {
            name: eName.value.trim(),
            description: eDesc.value.trim(),
            categoryId: eCat ? (eCat.value || null) : null,
        };
        if (isVariationMode) {
            const rows = document.getElementById('edit-var-body').rows;
            if (rows.length === 0) {
                editError.textContent = t('noVariations');
                btnEditSave.disabled = false;
                btnEditSave.textContent = t('btnSaveChanges');
                return;
            }
            update.hasVariations = true;
            update.variations = getVariationsFromBody('edit-var-body');
        } else {
            update.hasVariations = false;
            update.sku = eSku.value.trim() || '';
            update.wholesalePrice = eWs.value ? parseFloat(eWs.value) : null;
            update.retailPrice = eRetail.value ? parseFloat(eRetail.value) : null;
            update.moq = eMoq.value ? parseInt(eMoq.value, 10) : null;
        }
        await updateDoc(doc(db, 'products', editingDocId), update);
        closeEditModal();
        setStatus(t('productUpdated'));
    } catch (err) {
        editError.textContent = `Error: ${err.message}`;
    } finally {
        btnEditSave.disabled = false;
        btnEditSave.textContent = t('btnSaveChanges');
    }
});

if (btnModeCatalog) btnModeCatalog.addEventListener('click', () => setAppMode('catalog'));
if (btnModeDesigner) btnModeDesigner.addEventListener('click', () => setAppMode('designer'));

setMenuActions({
    newProduct: () => {
        hideReports();
        clearForm();
        setAppMode('catalog');
        fName.focus();
    },
    importCsv: () => importProductsCsv(),
    exportCsv: () => exportProductsCsv(),
    signOut: () => btnSignout.click(),
    clearForm: () => clearForm(),
    preferences: () => showPreferencesDialog(applyLanguage),
    catalogMode: () => setAppMode('catalog'),
    designerMode: () => setAppMode('designer'),
    refresh: () => {
        if (unsubscribeFirestore) {
            unsubscribeFirestore();
            unsubscribeFirestore = null;
        }
        startFirestoreListener();
        setStatus('Refreshed.');
    },
    sortName: () => { currentSort = 'name'; setProducts(allProducts); },
    sortDate: () => { currentSort = 'date'; setProducts(allProducts); },
    sortPrice: () => { currentSort = 'price'; setProducts(allProducts); },
    about: () => showAboutDialog(),
    shortcuts: () => showShortcutsDialog(),
});

initMenuBar();
initSearch();

const btnCatNew = document.getElementById('btn-cat-new');
if (btnCatNew) {
    btnCatNew.addEventListener('click', async () => {
        const name = await win95Input(t('catNewCategory'), t('catNamePrompt'));
        if (name) addCategory(name);
    });
}

const btnCatCollapse = document.getElementById('btn-cat-collapse');
const catTreeWrap = document.getElementById('category-tree-wrap');
if (btnCatCollapse && catTreeWrap) {
    btnCatCollapse.addEventListener('click', () => {
        const collapsed = catTreeWrap.style.display === 'none';
        catTreeWrap.style.display = collapsed ? '' : 'none';
        btnCatCollapse.textContent = collapsed ? '\u25B2' : '\u25BC';
    });
}

onCategoriesChange((categories) => {
    updateSearchCategories(categories);
});

const btnBackCatalog = document.getElementById('btn-back-catalog');
if (btnBackCatalog) btnBackCatalog.addEventListener('click', () => hideReports());

document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'n') {
        event.preventDefault();
        clearForm();
        setAppMode('catalog');
        fName.focus();
    }
    if (event.ctrlKey && event.key === 's' && mainWindow.style.display === 'block' && currentAppMode === 'catalog') {
        event.preventDefault();
        btnSave.click();
    }
    if (event.ctrlKey && event.key === 'f') {
        event.preventDefault();
        const searchEl = document.getElementById('search-text');
        if (searchEl) searchEl.focus();
    }
    if (event.key === 'Escape') {
        if (document.querySelector('.image-viewer-overlay')) {
            closeImageViewer();
            return;
        }
        if (editOverlay.style.display === 'flex') closeEditModal();
        document.querySelectorAll('.modal-overlay').forEach((element) => element.remove());
    }
});

applyLanguage(localStorage.getItem('lang') || 'en');
syncModeUi({ rerender: false, suppressStatus: true });
