const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

const coreAPI = {
  auth: Object.freeze({
    status: () => invoke('auth:status'),
    createAdmin: (username, password, securityQuestion, securityAnswer) => invoke('auth:create-admin', username, password, securityQuestion, securityAnswer),
    login: (username, password) => invoke('auth:login', username, password),
    changePassword: (userId, oldPassword, newPassword) => invoke('auth:change-password', userId, oldPassword, newPassword),
    securityQuestion: (username) => invoke('auth:security-question', username),
    resetPassword: (username, answer, newPassword) => invoke('auth:reset-password', username, answer, newPassword)
  }),
  license: Object.freeze({
    trialStatus: () => invoke('license:trial-status'),
    activate: (licenseKey, profil) => invoke('license:activate', licenseKey, profil),
    localStatus: () => invoke('license:local-status')
  }),
  branding: Object.freeze({
    get: () => invoke('branding:get'),
    save: (data) => invoke('branding:save', data)
  }),
  database: Object.freeze({
    integrity: () => invoke('db:integrity'),
    backup: () => invoke('db:backup'),
    stats: () => invoke('db:stats'),
    storageLoad: () => invoke('storage:load'),
    storageSet: (key, value) => invoke('storage:set', key, value),
    storageRemove: (key) => invoke('storage:remove', key),
    saveProject: (project) => invoke('project:save', project),
    updateProject: (id, patch) => invoke('project:update', id, patch),
    deleteProject: (id) => invoke('project:delete', id),
    projectsList: () => invoke('projects:list'),
    syncMasterData: (table, rows) => invoke('data:sync-master', table, rows)
  }),
  support: Object.freeze({ whatsapp: (message) => invoke('app:open-whatsapp', message) }),
  network: Object.freeze({
    lanInfo: () => invoke('network:lan-info'),
    toggleSync: (enabled) => invoke('network:toggle-sync', enabled)
  })
};

/* Compatibility adapter for the existing road-RAB renderer. */
const legacyAPI = {
  getProjects: async () => {
    const [rows, store] = await Promise.all([
      coreAPI.database.projectsList(),
      coreAPI.database.storageLoad()
    ]);
    return rows.map((p) => {
      let meta = {};
      try { meta = JSON.parse(store[`project_meta_${p.id}`] || '{}'); } catch (_) { meta = {}; }
      let rabItems = [];
      let routePoints = [];
      try { rabItems = JSON.parse(store[`rab_items_${p.id}`] || '[]'); } catch (_) {}
      try { routePoints = JSON.parse(store[`route_points_${p.id}`] || '[]'); } catch (_) {}
      return {
        id: String(p.id),
        nama: p.name || '',
        lokasi: p.location || meta.lokasi || '',
        panjang: meta.panjang ?? 0,
        lebar: meta.lebar ?? 0,
        jenisKonstruksi: meta.jenisKonstruksi || 'Perkerasan Jalan',
        tebalPerkerasan: meta.tebalPerkerasan ?? 0,
        jenisPondasi: meta.jenisPondasi || '',
        kondisiTanah: meta.kondisiTanah || '',
        drainase: !!meta.drainase,
        bahuJalan: !!meta.bahuJalan,
        catatan: meta.catatan || '',
        progress: Number(meta.progress) || 0,
        status: p.status || 'Draft',
        nilaiProyek: Number(p.value) || 0,
        rabItems,
        routePoints
      };
    });
  },

  getProject: async (id) => {
    const project = (await legacyAPI.getProjects()).find((p) => String(p.id) === String(id));
    if (!project) throw new Error('Proyek tidak ditemukan.');
    return project;
  },

  addProject: async (p) => {
    const payload = {
      code: 'JLN-' + Date.now(),
      name: p.nama,
      location: p.lokasi,
      value: 0,
      status: 'Draft',
      owner: null,
      start_date: null,
      end_date: null
    };
    const id = await coreAPI.database.saveProject(payload);
    const meta = {
      lokasi: p.lokasi || '',
      panjang: Number(p.panjang) || 0,
      lebar: Number(p.lebar) || 0,
      jenisKonstruksi: p.jenisKonstruksi || 'Perkerasan Jalan',
      tebalPerkerasan: Number(p.tebalPerkerasan) || 0,
      jenisPondasi: p.jenisPondasi || '',
      kondisiTanah: p.kondisiTanah || '',
      drainase: !!p.drainase,
      bahuJalan: !!p.bahuJalan,
      catatan: p.catatan || '',
      progress: 0
    };
    await coreAPI.database.storageSet(`project_meta_${id}`, JSON.stringify(meta));
    return id;
  },

  deleteProject: (id) => coreAPI.database.deleteProject(Number(id)),

  getDashboardStats: async () => {
    const projects = await legacyAPI.getProjects();
    const totalNilai = projects.reduce((s, p) => s + (Number(p.nilaiProyek) || 0), 0);
    const selesai = projects.filter((p) => String(p.status).toLowerCase() === 'selesai').length;
    const avgProgress = projects.length ? Math.round(projects.reduce((s, p) => s + (Number(p.progress) || 0), 0) / projects.length) : 0;
    return {
      totalProyek: projects.length,
      totalNilai,
      proyekBerjalan: projects.length - selesai,
      proyekSelesai: selesai,
      avgProgress,
      recent: projects.slice(0, 5).map((p) => ({ nama: p.nama, progress: p.progress || 0, nilai: p.nilaiProyek || 0 }))
    };
  },

  getDefaultPrices: async () => [
    { kategori: 'Pekerjaan Umum', uraian: 'Mobilisasi', volume: 1, satuan: 'ls', harga: 0 },
    { kategori: 'Pekerjaan Tanah', uraian: 'Galian tanah', volume: 0, satuan: 'm3', harga: 0 },
    { kategori: 'Pekerjaan Tanah', uraian: 'Timbunan pilihan', volume: 0, satuan: 'm3', harga: 0 },
    { kategori: 'Perkerasan', uraian: 'Lapis pondasi agregat', volume: 0, satuan: 'm3', harga: 0 },
    { kategori: 'Perkerasan', uraian: 'Perkerasan beton/aspal', volume: 0, satuan: 'm2', harga: 0 },
    { kategori: 'Drainase', uraian: 'Pekerjaan drainase', volume: 0, satuan: 'm', harga: 0 }
  ],

  saveRab: async (projectId, items) => {
    await coreAPI.database.storageSet(`rab_items_${projectId}`, JSON.stringify(Array.isArray(items) ? items : []));
    return true;
  },

  saveRoute: async (projectId, points) => {
    await coreAPI.database.storageSet(`route_points_${projectId}`, JSON.stringify(Array.isArray(points) ? points : []));
    return true;
  }
};

contextBridge.exposeInMainWorld('alfastecAPI', Object.freeze(coreAPI));
contextBridge.exposeInMainWorld('api', Object.freeze(legacyAPI));
