(function(root) {
  'use strict';
  const roleTypes = {master:'new_messages', executor:'executor_assigned', tech:'quality_control_requested'};
  function typesFor(user) {
    const roles = Array.isArray(user?.roles) ? user.roles : [user?.role, user?.roleName];
    const roleEvents = roles.map(role => roleTypes[typeof role === 'object' ? (role.code || role.name) : role]).filter(Boolean);
    // New chat messages are relevant to every authorized employee, not only the МП role.
    return ['new_messages', ...roleEvents].filter((type,index,array) => array.indexOf(type) === index);
  }
  function dateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    const options = {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'};
    const zone = root.ITUS_CONFIG?.DISPLAY_TIME_ZONE;
    if (zone) options.timeZone = zone;
    return new Intl.DateTimeFormat('ru-RU',options).format(date);
  }
  function unread(data) {
    const value = data?.unreadMessagesCount ?? data?.unreadCount ?? data?.bot?.unreadCount;
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  }
  function preferences(id) {
    try { return {new_messages:true,executor_assigned:true,quality_control_requested:true,system:true,
      ...JSON.parse(localStorage.getItem('itus.notifications.'+id) || '{}')}; }
    catch { return {new_messages:true,executor_assigned:true,quality_control_requested:true,system:true}; }
  }
  root.ITUS_FEATURES = {typesFor, dateTime, unread, preferences};
})(typeof window === 'undefined' ? globalThis : window);
