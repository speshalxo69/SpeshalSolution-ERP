// ================================================================
//  CATEGORIES — Firestore CRUD + Tree UI
// ================================================================
import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp } from './firebase-init.js';
import { t } from './i18n.js';

let categoriesCache = [];   // flat array of { id, name, parentId, order }
let unsubCategories = null;
let onChangeCallbacks = [];

export function getCategories() { return categoriesCache; }

export function onCategoriesChange(cb) { onChangeCallbacks.push(cb); }

function notify() { onChangeCallbacks.forEach(cb => cb(categoriesCache)); }

export function startCategoriesListener() {
    const q = query(collection(db, 'categories'), orderBy('order', 'asc'));
    unsubCategories = onSnapshot(q, (snap) => {
        // Hide error banner on success
        const errBanner = document.getElementById('cat-permission-error');
        if (errBanner) errBanner.style.display = 'none';

        categoriesCache = [];
        snap.forEach(d => categoriesCache.push({ id: d.id, ...d.data() }));
        notify();
        renderCategoryTree();
        populateCategoryDropdowns();
    }, (err) => {
        console.error('[Categories]', err);
        // Show error banner
        const errBanner = document.getElementById('cat-permission-error');
        if (errBanner) errBanner.style.display = 'block';
    });
}

export function stopCategoriesListener() {
    if (unsubCategories) { unsubCategories(); unsubCategories = null; }
}

export async function addCategory(name, parentId = null) {
    const maxOrder = categoriesCache.reduce((m, c) => Math.max(m, c.order || 0), 0);
    try {
        await addDoc(collection(db, 'categories'), {
            name,
            parentId,
            order: maxOrder + 1,
            createdAt: serverTimestamp(),
            createdBy: 'admin'
        });
    } catch (err) {
        if (err.code === 'permission-denied') {
            alert('Cannot save category: Firestore rules block the "categories" collection.\n\nIn Firebase Console → Firestore → Rules, add:\n\nmatch /categories/{doc} {\n  allow read, write: if request.auth != null;\n}');
        } else {
            alert('Error saving category: ' + err.message);
        }
        throw err;
    }
}

export async function renameCategory(id, newName) {
    await updateDoc(doc(db, 'categories', id), { name: newName });
}

export async function deleteCategoryById(id) {
    // Also delete sub-categories
    const children = categoriesCache.filter(c => c.parentId === id);
    for (const child of children) {
        await deleteCategoryById(child.id);
    }
    await deleteDoc(doc(db, 'categories', id));
}

// ── Win95-style input dialog (replaces prompt()) ──
export function win95Input(title, label, defaultValue = '') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="login-dialog" style="width:280px;">
                <div class="login-title-bar">
                    <span>${title}</span>
                    <button class="title-btn w95-cancel-x">\u2715</button>
                </div>
                <div class="login-body" style="text-align:left;">
                    <div class="login-field">
                        <label>${label}</label>
                        <input type="text" class="w95-input" value="${defaultValue.replace(/"/g, '&quot;')}" maxlength="80">
                    </div>
                    <div class="login-btn-row" style="justify-content:flex-end; gap:6px;">
                        <button class="btn w95-cancel-btn" style="min-width:70px;">Cancel</button>
                        <button class="btn w95-ok-btn" style="min-width:70px;">OK</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const input = overlay.querySelector('.w95-input');
        const ok    = overlay.querySelector('.w95-ok-btn');
        const cancel = overlay.querySelector('.w95-cancel-btn');
        const closeX = overlay.querySelector('.w95-cancel-x');

        input.focus();
        input.select();

        const confirm = () => { const v = input.value.trim(); overlay.remove(); resolve(v || null); };
        const dismiss = () => { overlay.remove(); resolve(null); };

        ok.addEventListener('click', confirm);
        cancel.addEventListener('click', dismiss);
        closeX.addEventListener('click', dismiss);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') confirm();
            if (e.key === 'Escape') dismiss();
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
    });
}

// ── Win95-style confirm dialog (replaces confirm()) ──
export function win95Confirm(title, message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="login-dialog" style="width:300px;">
                <div class="login-title-bar">
                    <span>\u26A0 ${title}</span>
                    <button class="title-btn w95-no-x">\u2715</button>
                </div>
                <div class="login-body" style="text-align:left;">
                    <div style="margin-bottom:14px; font-size:11px; line-height:1.5;">${message}</div>
                    <div class="login-btn-row" style="justify-content:flex-end; gap:6px;">
                        <button class="btn w95-no-btn" style="min-width:70px;">No</button>
                        <button class="btn w95-yes-btn" style="min-width:70px;">Yes</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const yes  = overlay.querySelector('.w95-yes-btn');
        const no   = overlay.querySelector('.w95-no-btn');
        const noX  = overlay.querySelector('.w95-no-x');

        yes.focus();
        yes.addEventListener('click', () => { overlay.remove(); resolve(true); });
        no.addEventListener('click',  () => { overlay.remove(); resolve(false); });
        noX.addEventListener('click', () => { overlay.remove(); resolve(false); });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
    });
}

// ── Build tree structure ──
export function buildTree(cats = categoriesCache) {
    const topLevel = cats.filter(c => !c.parentId);
    const getChildren = (pid) => cats.filter(c => c.parentId === pid);
    function buildNode(cat) {
        return { ...cat, children: getChildren(cat.id).map(buildNode) };
    }
    return topLevel.map(buildNode);
}

// ── Get flat indented list for dropdowns ──
export function getFlatIndentedList() {
    const result = [];
    const tree = buildTree();
    function walk(nodes, depth) {
        for (const n of nodes) {
            result.push({ id: n.id, name: n.name, depth, label: '—'.repeat(depth) + ' ' + n.name });
            walk(n.children, depth + 1);
        }
    }
    walk(tree, 0);
    return result;
}

// ── Get category name by ID ──
export function getCategoryName(id) {
    if (!id) return null;
    const cat = categoriesCache.find(c => c.id === id);
    return cat ? cat.name : null;
}

// ── Render category tree in the panel ──
let categoryPanelVisible = false;

export function toggleCategoryPanel() {
    categoryPanelVisible = !categoryPanelVisible;
    const panel = document.getElementById('category-panel');
    if (panel) panel.style.display = categoryPanelVisible ? '' : 'none';
    if (categoryPanelVisible) renderCategoryTree();
}

export function isCategoryPanelVisible() { return categoryPanelVisible; }

function renderCategoryTree() {
    const container = document.getElementById('category-tree');
    if (!container) return;

    const tree = buildTree();
    container.innerHTML = '';

    if (tree.length === 0) {
        container.innerHTML = '<div style="color:#808080; padding:8px; font-style:italic;">No categories yet.</div>';
        return;
    }

    function renderNode(node, depth) {
        const row = document.createElement('div');
        row.className = 'cat-tree-row';
        row.style.paddingLeft = (depth * 16 + 4) + 'px';

        const hasChildren = node.children.length > 0;
        const toggle = document.createElement('span');
        toggle.className = 'cat-tree-toggle';
        toggle.textContent = hasChildren ? '[-]' : '   ';
        toggle.style.cursor = hasChildren ? 'pointer' : 'default';
        toggle.style.fontFamily = 'monospace';
        toggle.style.marginRight = '2px';
        toggle.style.fontSize = '10px';
        toggle.style.color = '#808080';

        const icon = document.createElement('span');
        icon.textContent = hasChildren ? '\uD83D\uDCC2' : '\uD83D\uDCC1';
        icon.style.marginRight = '3px';
        icon.style.fontSize = '11px';

        const label = document.createElement('span');
        label.className = 'cat-tree-label';
        label.textContent = node.name;
        label.style.cursor = 'pointer';
        label.style.fontSize = '11px';

        // Context buttons
        const btns = document.createElement('span');
        btns.className = 'cat-tree-btns';
        btns.style.marginLeft = '6px';
        btns.style.display = 'none';

        const btnSub = document.createElement('button');
        btnSub.className = 'cat-tree-btn';
        btnSub.textContent = '+';
        btnSub.title = t('catNewSubcategory');
        btnSub.addEventListener('click', async (e) => {
            e.stopPropagation();
            const name = await win95Input(t('catNewSubcategory'), t('catNamePrompt'));
            if (name) addCategory(name, node.id);
        });

        const btnRen = document.createElement('button');
        btnRen.className = 'cat-tree-btn';
        btnRen.textContent = '\u270E';
        btnRen.title = t('catRename');
        btnRen.addEventListener('click', async (e) => {
            e.stopPropagation();
            const name = await win95Input(t('catRename'), t('catRenamePrompt'), node.name);
            if (name && name !== node.name) renameCategory(node.id, name);
        });

        const btnDel = document.createElement('button');
        btnDel.className = 'cat-tree-btn cat-tree-btn-del';
        btnDel.textContent = '\u2715';
        btnDel.title = t('catDelete');
        btnDel.addEventListener('click', async (e) => {
            e.stopPropagation();
            const ok = await win95Confirm(t('catDelete'), t('catDeleteConfirm'));
            if (ok) deleteCategoryById(node.id);
        });

        btns.append(btnSub, btnRen, btnDel);

        row.append(toggle, icon, label, btns);
        row.addEventListener('mouseenter', () => btns.style.display = 'inline');
        row.addEventListener('mouseleave', () => btns.style.display = 'none');

        container.appendChild(row);

        const childContainer = document.createElement('div');
        childContainer.className = 'cat-tree-children';
        let expanded = true;
        for (const child of node.children) renderNode(child, depth + 1);

        if (hasChildren) {
            toggle.addEventListener('click', () => {
                expanded = !expanded;
                toggle.textContent = expanded ? '[-]' : '[+]';
                // Toggle visibility of next sibling children
                let next = row.nextElementSibling;
                while (next && next.classList.contains('cat-tree-row')) {
                    const nextDepth = parseInt(next.style.paddingLeft) || 0;
                    const rowDepth = (depth * 16 + 4);
                    if (nextDepth > rowDepth) {
                        next.style.display = expanded ? '' : 'none';
                    } else {
                        break;
                    }
                    next = next.nextElementSibling;
                }
            });
        }
    }

    tree.forEach(node => renderNode(node, 0));
}

// ── Populate category dropdowns ──
export function populateCategoryDropdowns() {
    const dropdowns = document.querySelectorAll('.category-select');
    const flat = getFlatIndentedList();

    dropdowns.forEach(sel => {
        const currentVal = sel.value;
        // Keep first option (No Category)
        sel.innerHTML = `<option value="">${t('catNone')}</option>`;
        flat.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.label;
            sel.appendChild(opt);
        });
        sel.value = currentVal || '';
    });
}
