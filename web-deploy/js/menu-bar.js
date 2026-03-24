// ================================================================
//  FUNCTIONAL MENU BAR
// ================================================================
import { t } from './i18n.js';
import { toggleCategoryPanel } from './categories.js';

let activeDropdown = null;
let menuActions = {};

export function setMenuActions(actions) { menuActions = actions; }

const menuStructure = {
    file: () => [
        { label: t('menuNewProduct'), action: 'newProduct' },
        { type: 'separator' },
        { label: t('menuSignOut'), action: 'signOut' },
    ],
    edit: () => [
        { label: t('menuClearForm'), action: 'clearForm' },
        { type: 'separator' },
        { label: t('menuPreferences'), action: 'preferences' },
    ],
    view: () => [
        { label: t('menuCategories'), action: 'toggleCategories' },
        { label: t('menuReports'), action: 'showReports' },
        { type: 'separator' },
        { label: t('menuRefresh'), action: 'refresh' },
        { type: 'separator' },
        { label: t('menuSortName'), action: 'sortName' },
        { label: t('menuSortDate'), action: 'sortDate' },
        { label: t('menuSortPrice'), action: 'sortPrice' },
    ],
    help: () => [
        { label: t('menuAbout'), action: 'about' },
        { label: t('menuShortcuts'), action: 'shortcuts' },
    ],
};

function closeDropdown() {
    if (activeDropdown) {
        activeDropdown.remove();
        activeDropdown = null;
    }
    document.removeEventListener('click', onDocClick);
}

function onDocClick(e) {
    if (activeDropdown && !activeDropdown.contains(e.target)) {
        closeDropdown();
    }
}

function openDropdown(menuKey, anchorEl) {
    closeDropdown();

    const items = menuStructure[menuKey]();
    const dropdown = document.createElement('div');
    dropdown.className = 'menu-dropdown';

    const rect = anchorEl.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = rect.bottom + 'px';
    dropdown.style.zIndex = '9000';

    items.forEach(item => {
        if (item.type === 'separator') {
            const sep = document.createElement('div');
            sep.className = 'menu-separator';
            dropdown.appendChild(sep);
            return;
        }

        const row = document.createElement('div');
        row.className = 'menu-dropdown-item';
        row.textContent = item.label;

        if (item.disabled) {
            row.classList.add('disabled');
        } else {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                closeDropdown();
                if (menuActions[item.action]) menuActions[item.action]();
            });
        }

        dropdown.appendChild(row);
    });

    document.body.appendChild(dropdown);
    activeDropdown = dropdown;

    // Close when clicking outside, defer to avoid immediate close
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
}

export function initMenuBar() {
    const menuItems = document.querySelectorAll('.menu-item[data-menu]');
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = item.dataset.menu;
            if (activeDropdown) {
                closeDropdown();
            } else {
                openDropdown(key, item);
            }
        });

        // Hover-switch when a menu is open
        item.addEventListener('mouseenter', () => {
            if (activeDropdown) {
                openDropdown(item.dataset.menu, item);
            }
        });
    });
}

// ── About Dialog ──
export function showAboutDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="login-dialog" style="width:280px;">
            <div class="login-title-bar">
                <span>${t('aboutTitle')}</span>
                <button class="title-btn about-close">\u2715</button>
            </div>
            <div class="login-body" style="text-align:center;">
                <div style="font-size:36px; margin-bottom:8px;">🛒</div>
                <div style="font-weight:bold; font-size:13px; margin-bottom:4px;">Speshal ERP Solution</div>
                <div style="font-size:11px; color:#444; margin-bottom:4px;">${t('aboutVersion')}</div>
                <div style="font-size:11px; color:#444; margin-bottom:8px;">${t('aboutDesc')}</div>
                <hr class="login-divider">
                <div style="font-size:10px; color:#808080; margin-bottom:12px;">&copy; 2024-2026 ${t('aboutCopyright')}</div>
                <div class="login-btn-row" style="justify-content:center;">
                    <button class="btn about-ok" style="min-width:80px;">${t('aboutOk')}</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.about-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.about-ok').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ── Preferences Dialog ──
export function showPreferencesDialog(applyLanguage) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="login-dialog" style="width:260px;">
            <div class="login-title-bar">
                <span>${t('prefTitle')}</span>
                <button class="title-btn pref-close">\u2715</button>
            </div>
            <div class="login-body" style="text-align:left;">
                <div class="login-field">
                    <label>${t('prefLanguage')}</label>
                    <select id="pref-lang" style="width:100%; font-family:Tahoma,Arial,sans-serif; font-size:11px;
                        border-top:1px solid #808080; border-left:1px solid #808080;
                        border-right:1px solid #dfdfdf; border-bottom:1px solid #dfdfdf;
                        padding:2px 4px; background:#fff;">
                        <option value="en">English</option>
                        <option value="fr">Français</option>
                        <option value="ar">العربية</option>
                    </select>
                </div>
                <div class="login-btn-row" style="justify-content:center;">
                    <button class="btn pref-ok" style="min-width:80px;">${t('prefOk')}</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const sel = overlay.querySelector('#pref-lang');
    sel.value = localStorage.getItem('lang') || 'en';

    overlay.querySelector('.pref-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.pref-ok').addEventListener('click', () => {
        applyLanguage(sel.value);
        overlay.remove();
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ── Shortcuts Dialog ──
export function showShortcutsDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="login-dialog" style="width:300px;">
            <div class="login-title-bar">
                <span>${t('menuShortcuts')}</span>
                <button class="title-btn shortcuts-close">\u2715</button>
            </div>
            <div class="login-body" style="text-align:left;">
                <table style="width:100%; font-size:11px; border-collapse:collapse;">
                    <tr><td style="padding:3px 6px; font-weight:bold;">Ctrl+N</td><td>New Product</td></tr>
                    <tr><td style="padding:3px 6px; font-weight:bold;">Ctrl+S</td><td>Save Product</td></tr>
                    <tr><td style="padding:3px 6px; font-weight:bold;">Ctrl+F</td><td>Focus Search</td></tr>
                    <tr><td style="padding:3px 6px; font-weight:bold;">Escape</td><td>Close Dialog</td></tr>
                </table>
                <div class="login-btn-row" style="justify-content:center; margin-top:8px;">
                    <button class="btn shortcuts-ok" style="min-width:80px;">OK</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.shortcuts-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.shortcuts-ok').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}
