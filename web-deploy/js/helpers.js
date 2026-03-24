// ================================================================
//  HELPERS
// ================================================================
const statusText = document.getElementById('status-text');
const msgBox     = document.getElementById('msg-box');

export function setStatus(msg) { statusText.textContent = msg; }

export function showMsg(text, type) {
    msgBox.textContent = text;
    msgBox.className = `msg-box ${type}`;
    msgBox.style.display = 'block';
}

export function hideMsg() {
    msgBox.style.display = 'none';
    msgBox.textContent = '';
    msgBox.className = 'msg-box';
}

export function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
}

export function placeholderSvg() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="110">
        <rect width="150" height="110" fill="#c0c0c0"/>
        <text x="75" y="55" dominant-baseline="middle" text-anchor="middle"
              font-family="Tahoma,Arial" font-size="10" fill="#808080">No Image</text></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
