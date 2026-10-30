import { db } from './db.js';
import { eventSystem } from './events.js';

export class BackupService {
  constructor() {
    this.backupInterval = null;
  }

  async createBackup() {
    const backup = {
      version: 1,
      timestamp: new Date(),
      database: {},
      metadata: {
        appVersion: '2.0.0',
        userCount: await database.db.utilisateurs.count(),
        deviceCount: await database.db.equipements.count()
      }
    };

    // Backup all tables
    const tables = database.db.tables.map(table => table.name);
    await Promise.all(tables.map(async (table) => {
      backup.database[table] = await database.db[table].toArray();
    }));

    return backup;
  }

  async restoreBackup(backupData) {
    if (!this.validateBackup(backupData)) {
      throw new Error('Invalid backup format');
    }

    // Start transaction
    await database.db.transaction('rw', database.db.tables, async () => {
      // Clear existing data
      await Promise.all(database.db.tables.map(table => table.clear()));

      // Restore data
      for (const tableName in backupData.database) {
        if (database.db[tableName]) {
          await database.db[tableName].bulkAdd(backupData.database[tableName]);
        }
      }
    });

    eventSystem.dispatch('backup-restored', {
      timestamp: new Date(),
      userCount: backupData.metadata.userCount,
      deviceCount: backupData.metadata.deviceCount
    });
  }

  validateBackup(backupData) {
    if (!backupData || !backupData.database || !backupData.timestamp) {
      return false;
    }

    // Basic validation for required tables
    const requiredTables = ['utilisateurs', 'equipements', 'salles', 'baies'];
    return requiredTables.every(table => backupData.database[table]);
  }

  async exportToFile() {
    const backup = await this.createBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `2mtech-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    eventSystem.dispatch('backup-created', {
      timestamp: new Date(),
      size: blob.size
    });
  }

  async importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (event) => {
        try {
          const backup = JSON.parse(event.target.result);
          await this.restoreBackup(backup);
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read backup file'));
      };

      reader.readAsText(file);
    });
  }

  startAutoBackup(interval = 'weekly') {
    this.stopAutoBackup();

    const intervals = {
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000
    };

    const ms = intervals[interval] || intervals.weekly;

    this.backupInterval = setInterval(async () => {
      try {
        await this.exportToFile();
        eventSystem.dispatch('auto-backup-completed');
      } catch (error) {
        eventSystem.dispatch('auto-backup-failed', { error });
      }
    }, ms);
  }

  stopAutoBackup() {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
    }
  }
}