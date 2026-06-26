/**
 * 对白「说话人姓名」颜色预设；编辑器与运行端共用。
 */
window.SpeakerNameColorPresets = [
    { value: '#ffd700', label: '金黄（旧默认）' },
    { value: '#ffffff', label: '纯白' },
    { value: '#f5f5f5', label: '亮白灰' },
    { value: '#e8e8e8', label: '浅灰白' },
    { value: '#a8d8ff', label: '冰蓝' },
    { value: '#7dd3c0', label: '薄荷绿' },
    { value: '#ffb8d9', label: '樱粉' },
    { value: '#ffcc99', label: '浅杏橙' },
    { value: '#d4b8ff', label: '淡紫' },
    { value: '#ff8a80', label: '珊瑚浅红' }
];

window.normalizeSpeakerNameColor = function (raw) {
    const v = String(raw || '').trim().toLowerCase();
    const list = window.SpeakerNameColorPresets || [];
    const hit = list.find(p => String(p.value).toLowerCase() === v);
    return hit ? hit.value : (list[0] && list[0].value) || '#ffd700';
};
