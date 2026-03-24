// ================================================================
//  APP — Main entry point, wires all modules together
// ================================================================
import { LOCAL_USERS, CLOUDINARY_CLOUD, CLOUDINARY_PRESET } from './config.js';
import { auth, db, signInAnonymously, signOut, onAuthStateChanged, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp } from './firebase-init.js';
import { LANGS, t, currentLang, setLang } from './i18n.js';
import { setStatus, showMsg, hideMsg, formatBytes, placeholderSvg } from './helpers.js';
import { startCategoriesListener, stopCategoriesListener, toggleCategoryPanel, addCategory, getCategories, getCategoryName, onCategoriesChange, populateCategoryDropdowns, win95Input, win95Confirm } from './categories.js';
import { initSearch, setProducts, onFilterChange, clearFilters, updateSearchCategories } from './search.js';
import { initMenuBar, setMenuActions, showAboutDialog, showPreferencesDialog, showShortcutsDialog } from './menu-bar.js';
import { toggleReports, hideReports, renderReports, isReportVisible } from './reports.js';

// ================================================================
//  STATE
// ================================================================
let unsubscribeFirestore = null;
let localUsername = null;
let lastSnapshot  = null;
let allProducts = [];       // { id, data } array
let selectedFile = null;
let formMode = 'simple';
let editingDocId = null;
let currentSort = 'date';   // 'date' | 'name' | 'price'

// ================================================================
//  DOM REFERENCES
// ================================================================
const loginScreen  = document.getElementById('login-screen');
const mainWindow   = document.getElementById('main-window');
const btnLogin     = document.getElementById('btn-login');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const loginError   = document.getElementById('login-error');
const btnSignout   = document.getElementById('btn-signout');
const userName     = document.getElementById('user-name');
const dropZone     = document.getElementById('drop-zone');
const fileInput    = document.getElementById('file-input');
const dropHint     = document.getElementById('drop-hint');
const btnSave      = document.getElementById('btn-save');
const btnClear     = document.getElementById('btn-clear');
const galleryGrid  = document.getElementById('gallery-grid');
const productCount = document.getElementById('product-count');
const statusDb     = document.getElementById('status-db');
const progressWrap = document.getElementById('progress-wrap');
const progressFill = document.getElementById('progress-fill');
const fName   = document.getElementById('f-name');
const fSku    = document.getElementById('f-sku');
const fWs     = document.getElementById('f-ws');
const fRetail = document.getElementById('f-retail');
const fMoq    = document.getElementById('f-moq');
const fDesc   = document.getElementById('f-desc');
const fCat    = document.getElementById('f-category');

// Edit modal references
const editOverlay   = document.getElementById('edit-overlay');
const editError     = document.getElementById('edit-error');
const btnEditSave   = document.getElementById('btn-edit-save');
const btnEditCancel = document.getElementById('btn-edit-cancel');
const btnEditClose  = document.getElementById('btn-edit-close');
const eName   = document.getElementById('e-name');
const eSku    = document.getElementById('e-sku');
const eWs     = document.getElementById('e-ws');
const eRetail = document.getElementById('e-retail');
const eMoq    = document.getElementById('e-moq');
const eDesc   = document.getElementById('e-desc');
const eCat    = document.getElementById('e-category');

// ================================================================
//  LANGUAGE
// ================================================================
function applyLanguage(lang) {
    setLang(lang);
    localStorage.setItem('lang', lang);
    document.body.classList.toggle('rtl', lang === 'ar');
    document.documentElement.lang = lang;

    document.querySelectorAll('.lang-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.lang === lang);
    });

    const map = {
        't-login-titlebar':  'loginTitleBar',
        't-login-title':     'loginTitle',
        't-login-subtitle':  'loginSubtitle',
        't-label-username':  'labelUsername',
        't-label-password':  'labelPassword',
        'btn-login':         'btnLogin',
        't-section-add':     'sectionAdd',
        't-drag-drop':       'dragDrop',
        't-or-browse':       'orBrowse',
        't-label-name':      'labelName',
        't-label-sku':       'labelSku',
        't-label-ws':        'labelWs',
        't-label-retail':    'labelRetail',
        't-label-moq':       'labelMoq',
        't-label-desc':      'labelDesc',
        't-label-category':  'labelCategory',
        'btn-clear':         'btnClear',
        'btn-save':          'btnSave',
        't-section-db':      'sectionDb',
        'btn-signout':       'btnSignout',
        't-edit-title':      'editTitle',
        't-edit-label-name': 'editLabelName',
        't-edit-label-sku':  'editLabelSku',
        't-edit-label-ws':   'editLabelWs',
        't-edit-label-retail':'editLabelRetail',
        't-edit-label-moq':  'editLabelMoq',
        't-edit-label-desc': 'editLabelDesc',
        't-edit-label-category': 'editLabelCategory',
        'btn-edit-cancel':   'btnCancel',
        'btn-edit-save':     'btnSaveChanges',
        'tab-simple':        'btnSimple',
        'tab-variations':    'btnVariations',
        't-var-col-label':   'varColLabel',
        't-var-col-sku':     'varColSku',
        't-var-col-ws':      'varColWs',
        't-var-col-retail':  'varColRetail',
        't-var-col-moq':     'varColMoq',
        'btn-add-row':       'btnAddRow',
        't-evar-col-label':  'varColLabel',
        't-evar-col-sku':    'varColSku',
        't-evar-col-ws':     'varColWs',
        't-evar-col-retail': 'varColRetail',
        't-evar-col-moq':    'varColMoq',
        'btn-edit-add-row':  'btnAddRow',
        // Menu
        'menu-file': 'menuFile',
        'menu-edit': 'menuEdit',
        'menu-view': 'menuView',
        'menu-help': 'menuHelp',
        // Search
        'search-clear': 'searchClearFilters',
        // Category panel
        'cat-panel-title': 'catManager',
        'btn-cat-new': 'catNewCategory',
        // Reports
        'report-title': 'reportTitle',
        'btn-back-catalog': 'reportBackToCatalog',
    };

    Object.entries(map).forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = t(key);
    });

    // Update placeholders
    const searchText = document.getElementById('search-text');
    if (searchText) searchText.placeholder = t('searchPlaceholder');

    // Re-populate category dropdowns with translated labels
    populateCategoryDropdowns();
    updateSearchCategories(getCategories());

    // Re-render gallery
    if (allProducts.length > 0) renderFilteredGallery(allProducts);
}

document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => applyLanguage(btn.dataset.lang));
});

// ================================================================
//  FORM MODE (simple / variations)
// ================================================================
function switchFormMode(mode) {
    formMode = mode;
    document.getElementById('simple-fields').style.display    = mode === 'simple'     ? '' : 'none';
    document.getElementById('variations-fields').style.display = mode === 'variations' ? '' : 'none';
    document.querySelectorAll('.mode-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    if (mode === 'variations' && document.getElementById('var-body').rows.length === 0) {
        addVariationRow('var-body'); addVariationRow('var-body');
    }
}

document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => switchFormMode(btn.dataset.mode));
});

function addVariationRow(tbodyId) {
    const tbody = document.getElementById(tbodyId);
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><input type="text"   class="v-label"  placeholder="e.g. S / Red" maxlength="40"></td>
        <td><input type="text"   class="v-sku"    maxlength="40"></td>
        <td><input type="number" class="v-ws"     min="0" step="1"></td>
        <td><input type="number" class="v-retail" min="0" step="1"></td>
        <td><input type="number" class="v-moq"    min="1" step="1"></td>
        <td><button type="button" class="var-remove-btn" title="Remove">\u2715</button></td>`;
    row.querySelector('.var-remove-btn').addEventListener('click', () => row.remove());
    tbody.appendChild(row);
}

function getVariationsFromBody(tbodyId) {
    const rows = document.getElementById(tbodyId).rows;
    const result = [];
    for (const row of rows) {
        const label  = row.querySelector('.v-label').value.trim();
        const sku    = row.querySelector('.v-sku').value.trim();
        const ws     = row.querySelector('.v-ws').value;
        const retail = row.querySelector('.v-retail').value;
        const moq    = row.querySelector('.v-moq').value;
        result.push({
            label,
            sku:   sku   || '',
            wholesalePrice: ws     ? parseFloat(ws)    : null,
            retailPrice:    retail ? parseFloat(retail) : null,
            moq:            moq    ? parseInt(moq, 10)  : null,
        });
    }
    return result;
}

document.getElementById('btn-add-row').addEventListener('click', () => addVariationRow('var-body'));
document.getElementById('btn-edit-add-row').addEventListener('click', () => addVariationRow('edit-var-body'));

// ================================================================
//  AUTH STATE
// ================================================================
onAuthStateChanged(auth, (user) => {
    if (user && localUsername) {
        loginScreen.classList.add('hidden');
        mainWindow.style.display = 'block';
        userName.textContent = localUsername;
        setStatus(`${t('loggedInAs')} ${localUsername}`);
        applyLanguage(localStorage.getItem('lang') || 'en');
        startFirestoreListener();
        startCategoriesListener();
    } else {
        mainWindow.style.display = 'none';
        loginScreen.classList.remove('hidden');
        if (unsubscribeFirestore) { unsubscribeFirestore(); unsubscribeFirestore = null; }
        stopCategoriesListener();
    }
});

// ================================================================
//  LOGIN
// ================================================================
loginPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnLogin.click(); });
loginUsername.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginPassword.focus(); });

btnLogin.addEventListener('click', async () => {
    loginError.textContent = '';
    const username = loginUsername.value.trim();
    const password = loginPassword.value;
    if (!username) { loginError.textContent = t('enterUsername'); return; }
    if (!password) { loginError.textContent = t('enterPassword'); return; }

    const match = LOCAL_USERS.find(u => u.username === username && u.password === password);
    if (!match)  { loginError.textContent = t('invalidCreds'); return; }

    btnLogin.disabled = true;
    btnLogin.textContent = t('loggingIn');
    try {
        localUsername = username;
        await signInAnonymously(auth);
        loginScreen.classList.add('hidden');
        mainWindow.style.display = 'block';
        userName.textContent = localUsername;
        setStatus(`${t('loggedInAs')} ${localUsername}`);
        applyLanguage(localStorage.getItem('lang') || 'en');
        if (!unsubscribeFirestore) startFirestoreListener();
        startCategoriesListener();
    } catch (err) {
        localUsername = null;
        loginError.textContent = `${t('connectError')} ${err.message}`;
        btnLogin.disabled = false;
        btnLogin.textContent = t('btnLogin');
    }
});

// ================================================================
//  SIGN OUT
// ================================================================
btnSignout.addEventListener('click', async () => {
    const ok = await win95Confirm(t('btnSignout'), t('signoutConfirm'));
    if (!ok) return;
    clearForm();
    hideReports();
    localUsername = null;
    await signOut(auth);
});

// ================================================================
//  FIRESTORE LISTENER
// ================================================================
function startFirestoreListener() {
    const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
    unsubscribeFirestore = onSnapshot(q,
        (snapshot) => {
            statusDb.textContent = '\uD83D\uDFE2 Connected';
            lastSnapshot = snapshot;
            allProducts = [];
            snapshot.forEach((docSnap) => allProducts.push({ id: docSnap.id, data: docSnap.data() }));
            setProducts(allProducts);
        },
        (err) => {
            statusDb.textContent = '\uD83D\uDD34 Error';
            galleryGrid.innerHTML = '';
            const d = document.createElement('div');
            d.className = 'gallery-empty';
            d.style.color = '#cc0000';
            d.textContent = `Database error: ${err.message}`;
            galleryGrid.appendChild(d);
        }
    );
}

// ================================================================
//  GALLERY RENDERING
// ================================================================
function renderFilteredGallery(products) {
    const count = products.length;
    productCount.textContent = `(${count})`;
    galleryGrid.innerHTML = '';
    if (count === 0) {
        const empty = document.createElement('div');
        empty.className = 'gallery-empty';
        empty.textContent = t('noProducts');
        galleryGrid.appendChild(empty);
        return;
    }

    // Sort
    let sorted = [...products];
    if (currentSort === 'name') {
        sorted.sort((a, b) => (a.data.name || '').localeCompare(b.data.name || ''));
    } else if (currentSort === 'price') {
        const getPrice = (p) => {
            if (p.data.hasVariations && Array.isArray(p.data.variations) && p.data.variations.length > 0) {
                const prices = p.data.variations.map(v => v.wholesalePrice).filter(v => v != null);
                return prices.length > 0 ? Math.min(...prices) : Infinity;
            }
            return p.data.wholesalePrice != null ? p.data.wholesalePrice : Infinity;
        };
        sorted.sort((a, b) => getPrice(a) - getPrice(b));
    }
    // 'date' is default Firestore order, no re-sort needed

    sorted.forEach((p) => galleryGrid.appendChild(buildCard(p.data, p.id)));

    // Update reports if visible
    if (isReportVisible()) renderReports(allProducts);
}

// Connect search filter to gallery
onFilterChange(renderFilteredGallery);

// ================================================================
//  BUILD PRODUCT CARD
// ================================================================
function buildCard(p, id) {
    const card = document.createElement('div');
    card.className = 'product-card';

    const img = document.createElement('img');
    img.alt = p.name || ''; img.loading = 'lazy'; img.src = p.imageUrl || '';
    img.addEventListener('error', () => { img.src = placeholderSvg(); });

    const info = document.createElement('div');
    info.className = 'card-info';

    const name = document.createElement('div');
    name.className = 'card-name'; name.title = p.name || '';
    name.textContent = p.name || '(unnamed)';

    // Category badge
    let catBadge = null;
    if (p.categoryId) {
        const catName = getCategoryName(p.categoryId);
        if (catName) {
            catBadge = document.createElement('div');
            catBadge.className = 'card-cat-badge';
            catBadge.textContent = catName;
        }
    }

    let priceBlock;
    if (p.hasVariations && Array.isArray(p.variations) && p.variations.length > 0) {
        const badge = document.createElement('div');
        badge.className = 'card-var-badge';
        badge.textContent = t('variationsBadge');

        const varList = document.createElement('div');
        varList.className = 'card-variations';
        const show = p.variations.slice(0, 3);
        show.forEach(v => {
            const row = document.createElement('div');
            row.className = 'card-var-row';
            const lbl = document.createElement('span');
            lbl.className = 'card-var-label';
            lbl.textContent = v.label || '\u2014';
            const pr = document.createElement('span');
            pr.className = 'card-var-price';
            pr.textContent = v.wholesalePrice != null
                ? `${Number(v.wholesalePrice).toLocaleString()} ${t('currency')}`
                : '\u2014';
            row.append(lbl, pr);
            varList.appendChild(row);
        });
        if (p.variations.length > 3) {
            const more = document.createElement('div');
            more.className = 'card-var-more';
            more.textContent = `+${p.variations.length - 3} more`;
            varList.appendChild(more);
        }
        priceBlock = document.createDocumentFragment();
        priceBlock.append(badge, varList);
    } else {
        const sku = document.createElement('div');
        sku.className = 'card-sku';
        sku.textContent = p.sku || '';

        const ws = document.createElement('div');
        ws.className = 'card-ws';
        ws.textContent = p.wholesalePrice != null
            ? `${Number(p.wholesalePrice).toLocaleString()} ${t('currency')}`
            : '\u2014';

        const moq = document.createElement('div');
        moq.className = 'card-moq';
        moq.textContent = p.moq != null ? `${t('moqLabel')} ${p.moq}` : '';

        priceBlock = document.createDocumentFragment();
        priceBlock.append(sku, ws, moq);
    }

    const btns = document.createElement('div');
    btns.className = 'card-btns';

    const editBtn = document.createElement('button');
    editBtn.className = 'card-btn';
    editBtn.textContent = t('btnEdit');
    editBtn.addEventListener('click', () => openEditModal(p, id));

    const delBtn = document.createElement('button');
    delBtn.className = 'card-btn card-btn-delete';
    delBtn.textContent = t('btnDelete');
    delBtn.addEventListener('click', () => deleteProduct(id, p.name));

    btns.append(editBtn, delBtn);
    info.append(name);
    if (catBadge) info.append(catBadge);
    info.append(priceBlock, btns);
    card.append(img, info);
    return card;
}

// ================================================================
//  DRAG & DROP
// ================================================================
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', (e) => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dragover'); });
dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) setFile(file);
    else showMsg(t('noImage'), 'error');
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });

function setFile(file) {
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        const existing = dropZone.querySelector('img');
        if (existing) existing.remove();
        dropHint.style.display = 'none';
        const img = document.createElement('img');
        img.src = e.target.result; img.alt = file.name;
        dropZone.appendChild(img);
    };
    reader.readAsDataURL(file);
    setStatus(`${file.name} (${formatBytes(file.size)})`);
}

// ================================================================
//  CLEAR FORM
// ================================================================
btnClear.addEventListener('click', clearForm);
function clearForm() {
    selectedFile = null; fileInput.value = '';
    fName.value = fSku.value = fWs.value = fRetail.value = fMoq.value = fDesc.value = '';
    if (fCat) fCat.value = '';
    const img = dropZone.querySelector('img');
    if (img) img.remove();
    dropHint.style.display = '';
    hideMsg();
    progressWrap.style.display = 'none';
    progressFill.style.width = '0%';
    setStatus(`${t('loggedInAs')} ${localUsername || ''}`);
    document.getElementById('var-body').innerHTML = '';
    switchFormMode('simple');
}

// ================================================================
//  SAVE TO CLOUD
// ================================================================
btnSave.addEventListener('click', async () => {
    hideMsg();
    if (!selectedFile)       return showMsg(t('noImage'), 'error');
    if (!fName.value.trim()) return showMsg(t('noName'),  'error');

    if (formMode === 'variations') {
        const rows = document.getElementById('var-body').rows;
        if (rows.length === 0) return showMsg(t('noVariations'), 'error');
    }

    btnSave.disabled = btnClear.disabled = true;
    progressWrap.style.display = 'block';
    progressFill.style.width = '0%';
    setStatus(t('uploadingImg'));
    showMsg(t('uploadingImg'), 'info');

    try {
        const imageUrl = await new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('upload_preset', CLOUDINARY_PRESET);
            formData.append('folder', 'products');
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`);
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    progressFill.style.width = Math.round((e.loaded / e.total) * 80) + '%';
                }
            });
            xhr.addEventListener('load', () => {
                if (xhr.status === 200) { progressFill.style.width = '85%'; resolve(JSON.parse(xhr.responseText).secure_url); }
                else reject(new Error(`Cloudinary error: ${xhr.statusText}`));
            });
            xhr.addEventListener('error', () => reject(new Error('Network error during upload.')));
            xhr.send(formData);
        });

        progressFill.style.width = '90%';
        setStatus(t('savingRecord'));
        showMsg(t('savingRecord'), 'info');

        const docData = {
            name:        fName.value.trim(),
            description: fDesc.value.trim(),
            imageUrl,
            uploadedBy:  localUsername || 'unknown',
            createdAt:   serverTimestamp(),
            categoryId:  fCat ? (fCat.value || null) : null,
        };

        if (formMode === 'variations') {
            docData.hasVariations = true;
            docData.variations    = getVariationsFromBody('var-body');
        } else {
            docData.hasVariations  = false;
            docData.sku            = fSku.value.trim() || '';
            docData.wholesalePrice = fWs.value    ? parseFloat(fWs.value)    : null;
            docData.retailPrice    = fRetail.value ? parseFloat(fRetail.value) : null;
            docData.moq            = fMoq.value   ? parseInt(fMoq.value, 10)  : null;
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
        btnSave.disabled = btnClear.disabled = false;
        setTimeout(() => { progressWrap.style.display = 'none'; progressFill.style.width = '0%'; }, 2500);
    }
});

// ================================================================
//  DELETE PRODUCT
// ================================================================
async function deleteProduct(id, name) {
    const ok = await win95Confirm(t('btnDelete'), `${t('deleteConfirm')}\n\n"${name}"`);
    if (!ok) return;
    try {
        await deleteDoc(doc(db, 'products', id));
        setStatus(t('productDeleted'));
    } catch (err) {
        console.error('[Delete]', err);
        alert(`Error: ${err.message}`);
    }
}

// ================================================================
//  EDIT MODAL
// ================================================================
function openEditModal(p, id) {
    editingDocId  = id;
    eName.value   = p.name        || '';
    eDesc.value   = p.description || '';
    editError.textContent = '';

    if (eCat) eCat.value = p.categoryId || '';

    const editSimple = document.getElementById('edit-simple-fields');
    const editVars   = document.getElementById('edit-variations-fields');
    const editVarBody = document.getElementById('edit-var-body');

    if (p.hasVariations && Array.isArray(p.variations)) {
        editSimple.style.display = 'none';
        editVars.style.display   = '';
        editVarBody.innerHTML    = '';
        p.variations.forEach(v => {
            addVariationRow('edit-var-body');
            const lastRow = editVarBody.lastElementChild;
            lastRow.querySelector('.v-label').value  = v.label  || '';
            lastRow.querySelector('.v-sku').value    = v.sku    || '';
            lastRow.querySelector('.v-ws').value     = v.wholesalePrice ?? '';
            lastRow.querySelector('.v-retail').value = v.retailPrice    ?? '';
            lastRow.querySelector('.v-moq').value    = v.moq            ?? '';
        });
    } else {
        editSimple.style.display = '';
        editVars.style.display   = 'none';
        eSku.value    = p.sku            || '';
        eWs.value     = p.wholesalePrice ?? '';
        eRetail.value = p.retailPrice    ?? '';
        eMoq.value    = p.moq            ?? '';
    }

    editOverlay.style.display = 'flex';
    eName.focus();
}

function closeEditModal() { editOverlay.style.display = 'none'; editingDocId = null; }

btnEditClose.addEventListener('click', closeEditModal);
btnEditCancel.addEventListener('click', closeEditModal);
editOverlay.addEventListener('click', (e) => { if (e.target === editOverlay) closeEditModal(); });

btnEditSave.addEventListener('click', async () => {
    if (!editingDocId) return;
    editError.textContent = '';
    if (!eName.value.trim()) { editError.textContent = t('noName'); return; }

    btnEditSave.disabled = true;
    btnEditSave.textContent = t('savingRecord');
    try {
        const isVarMode = document.getElementById('edit-variations-fields').style.display !== 'none';
        const update = {
            name:        eName.value.trim(),
            description: eDesc.value.trim(),
            categoryId:  eCat ? (eCat.value || null) : null,
        };
        if (isVarMode) {
            const rows = document.getElementById('edit-var-body').rows;
            if (rows.length === 0) { editError.textContent = t('noVariations'); btnEditSave.disabled = false; btnEditSave.textContent = t('btnSaveChanges'); return; }
            update.hasVariations = true;
            update.variations    = getVariationsFromBody('edit-var-body');
        } else {
            update.hasVariations  = false;
            update.sku            = eSku.value.trim() || '';
            update.wholesalePrice = eWs.value    ? parseFloat(eWs.value)    : null;
            update.retailPrice    = eRetail.value ? parseFloat(eRetail.value) : null;
            update.moq            = eMoq.value   ? parseInt(eMoq.value, 10)  : null;
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

// ================================================================
//  MENU BAR ACTIONS
// ================================================================
setMenuActions({
    newProduct: () => {
        hideReports();
        clearForm();
        fName.focus();
    },
    signOut: () => btnSignout.click(),
    clearForm: () => clearForm(),
    preferences: () => showPreferencesDialog(applyLanguage),
    toggleCategories: () => toggleCategoryPanel(),
    showReports: () => toggleReports(allProducts),
    refresh: () => {
        if (unsubscribeFirestore) { unsubscribeFirestore(); unsubscribeFirestore = null; }
        startFirestoreListener();
        setStatus('Refreshed.');
    },
    sortName:  () => { currentSort = 'name';  renderFilteredGallery(allProducts); },
    sortDate:  () => { currentSort = 'date';  renderFilteredGallery(allProducts); },
    sortPrice: () => { currentSort = 'price'; renderFilteredGallery(allProducts); },
    about: () => showAboutDialog(),
    shortcuts: () => showShortcutsDialog(),
});

initMenuBar();
initSearch();

// ── Category panel: "New Category" button ──
const btnCatNew = document.getElementById('btn-cat-new');
if (btnCatNew) {
    btnCatNew.addEventListener('click', async () => {
        const name = await win95Input(t('catNewCategory'), t('catNamePrompt'));
        if (name) addCategory(name);
    });
}

// ── Category panel: collapse/expand toggle ──
const btnCatCollapse = document.getElementById('btn-cat-collapse');
const catTreeWrap = document.getElementById('category-tree-wrap');
if (btnCatCollapse && catTreeWrap) {
    btnCatCollapse.addEventListener('click', () => {
        const collapsed = catTreeWrap.style.display === 'none';
        catTreeWrap.style.display = collapsed ? '' : 'none';
        btnCatCollapse.textContent = collapsed ? '\u25B2' : '\u25BC';
    });
}

// ── Categories change → update search dropdown ──
onCategoriesChange((cats) => {
    updateSearchCategories(cats);
});

// ── Reports back button ──
const btnBackCatalog = document.getElementById('btn-back-catalog');
if (btnBackCatalog) {
    btnBackCatalog.addEventListener('click', () => hideReports());
}

// ── Keyboard shortcuts ──
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); clearForm(); fName.focus(); }
    if (e.ctrlKey && e.key === 's' && mainWindow.style.display === 'block') { e.preventDefault(); btnSave.click(); }
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        const searchEl = document.getElementById('search-text');
        if (searchEl) searchEl.focus();
    }
    if (e.key === 'Escape') {
        if (editOverlay.style.display === 'flex') closeEditModal();
        document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
    }
});

// ── Initial language apply ──
applyLanguage(localStorage.getItem('lang') || 'en');
