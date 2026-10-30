/**
 * @file tests/map-acl-canonical-p0d.test.js — P0-D1 : la carte ET le serveur obéissent à la
 *       matrice canonique de `permissions.js`, action par action, type par type.
 *
 * LE DÉFAUT QUE CE FICHIER VERROUILLE.
 *
 * `permissionForStore()` ramenait TOUTE action non-lecture à la permission d'ÉCRITURE du
 * magasin (`access-control.js`) :
 *
 *     action === 'read' ? READ_PERMISSION_BY_STORE[s] : WRITE_PERMISSION_BY_STORE[s]
 *     rooms → 'room.edit'      baies → 'equipment.edit'     equipments → 'equipment.edit'
 *
 * Trois conséquences, toutes contraires à la matrice canonique :
 *
 *   1 · `delete` se résolvait en `room.edit` / `equipment.edit`. Le plafond du Chef étant
 *       « tout sauf zone.manage et access.review », un Chef pouvait SUPPRIMER salles, baies
 *       et équipements — alors que `permissions.js` lui déclare `delete:false` sur les trois.
 *
 *   2 · côté écran, `deleteItem()` ne vérifiait QUE le verrou de carte : aucune permission,
 *       ni par type ni par action. Cacher un bouton n'est pas une autorisation.
 *
 * LA RÈGLE MÉTIER, TRANCHÉE : LA MATRICE EST LE PLAFOND DE TOUTE MUTATION.
 *
 * Une habilitation de zone DÉLÈGUE un pouvoir à l'intérieur d'un périmètre ; elle n'ÉLÈVE
 * pas le rôle qui la reçoit. Deux questions distinctes, et il faut oui aux deux :
 *
 *     « ce rôle a-t-il le droit de faire cet acte ? »   ← la matrice canonique
 *     « et a-t-il autorité sur CE périmètre ? »         ← l'adhésion et l'habilitation
 *
 * Un technicien porteur d'`equipment.edit` sur sa zone agit dans cette zone AVEC les droits
 * de son rôle — il n'acquiert pas ceux d'un rôle supérieur. Avant cette garde, seule la
 * seconde question était posée, et la première était déduite de la permission d'écriture
 * du magasin.
 *
 * Et les deux refus portent désormais DEUX NOMS : `ROLE_ACTION_FORBIDDEN` quand le rôle
 * n'a pas le droit, `ZONE_FORBIDDEN` quand le périmètre manque. Les confondre envoyait un
 * administrateur chercher dans les habilitations un refus qui venait de la matrice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessControl } from '../scripts/access-control.js';

/* ══════════════════ double de pool ══════════════════ */

function poolDouble(seed = {}) {
  const magasins = new Map();
  let horloge = 0;
  const table = store => {
    if (!magasins.has(store)) magasins.set(store, new Map());
    return magasins.get(store);
  };
  for (const [store, records] of Object.entries(seed)) {
    for (const record of records) table(store).set(String(record.id), { data: record, deleted: false, updatedAt: ++horloge });
  }
  const client = {
    async query(sql, params = []) {
      const texte = String(sql).replace(/\s+/g, ' ').trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(texte)) return { rows: [] };
      if (texte.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [{}] };
      if (texte.startsWith('SELECT data, deleted FROM platform_records')) {
        const ligne = table(params[0]).get(String(params[1]));
        return { rows: ligne ? [{ data: ligne.data, deleted: ligne.deleted }] : [] };
      }
      if (texte.startsWith('SELECT data FROM platform_records')) {
        const ligne = table(params[0]).get(String(params[1]));
        return { rows: ligne && !ligne.deleted ? [{ data: ligne.data }] : [] };
      }
      if (texte.startsWith('SELECT record_id,data,updated_at FROM platform_records')) {
        return {
          rows: [...table(params[0]).entries()].filter(([, v]) => !v.deleted)
            .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
            .map(([id, v]) => ({ record_id: id, data: v.data, updated_at: v.updatedAt }))
        };
      }
      if (texte.startsWith('INSERT INTO platform_records')) {
        const tombe = texte.includes('::jsonb,TRUE');
        table(params[0]).set(String(params[1]), { data: tombe ? {} : JSON.parse(params[2]), deleted: tombe, updatedAt: ++horloge });
        return { rows: [] };
      }
      throw new Error(`requête non simulée : ${texte.slice(0, 80)}`);
    },
    release() {}
  };
  return { ...client, connect: async () => client };
}

/*
 * Chaque rôle à périmètre reçoit l'adhésion ET toutes les habilitations que son plafond
 * peut porter. C'est délibéré : si un refus survient malgré cela, il vient de la MATRICE,
 * pas d'une habilitation qu'on aurait « oublié » d'accorder. L'épreuve isole ainsi
 * exactement ce qu'elle prétend mesurer.
 */
const PERMISSIONS_ACCORDEES = ['zone.summary.read', 'equipment.read', 'equipment.edit',
  'room.edit', 'screen.read', 'screen.edit', 'cable.read', 'cable.edit', 'topology.read',
  'topology.edit', 'ticket.read', 'ticket.create', 'ticket.edit', 'note.read', 'note.create',
  'diagnostic.run', 'procedure.read', 'continuity.read', 'continuity.edit', 'diagram.read', 'diagram.edit'];

const ROLES = [
  { cle: 'admin', user: { id: 'u-admin', role: 'admin' } },
  { cle: 'manager', user: { id: 'u-manager', role: 'manager' } },
  { cle: 'chef', user: { id: 'u-chef', role: 'chef' } },
  { cle: 'responsible', user: { id: 'u-resp', role: 'responsible' } },
  { cle: 'technician', user: { id: 'u-tech', role: 'technicien' } },
  { cle: 'visitor', user: { id: 'u-visit', role: 'visiteur' } }
];

function decor() {
  const portees = [];
  for (const { user } of ROLES) {
    portees.push({ membership: { id: `M-${user.id}`, userId: user.id, zoneId: 'Z-A', status: 'active' } });
  }
  const grants = [];
  let n = 0;
  for (const { user } of ROLES) {
    for (const permission of PERMISSIONS_ACCORDEES) {
      grants.push({ id: `G${n += 1}`, userId: user.id, zoneId: 'Z-A', permission, status: 'active' });
    }
  }
  const pool = poolDouble({
    zones: [{ id: 'Z-A', name: 'Régie A', status: 'active' }],
    zone_memberships: portees.map(p => p.membership),
    zone_grants: grants,
    users: ROLES.map(r => ({ id: r.user.id, role: r.user.role })),
    resource_zones: [{ id: 'RZ1', resourceType: 'room', resourceId: 'r1', zoneId: 'Z-A' }],
    rooms: [{ id: 'r1', name: 'STC' }],
    baies: [{ id: 'b1', name: 'B01', roomId: 'r1' }],
    equipments: [{ id: 'e1', name: 'Switch A', roomId: 'r1' }]
  });
  return { pool, access: createAccessControl(pool) };
}

const FICHE = { rooms: { id: 'r1', name: 'STC' }, baies: { id: 'b1', name: 'B01', roomId: 'r1' },
  equipments: { id: 'e1', name: 'Switch A', roomId: 'r1' } };

/*
 * LA TABLE DE VÉRITÉ, RECOPIÉE DE `permissions.js` — pas déduite du code testé.
 * update = `edit` dans la matrice ; delete = `delete`.
 */
const ATTENDU = {
  // Recopiée de `permissions.js`, pas déduite du code testé. Chaque rôle à périmètre reçoit
  // ici TOUTES les habilitations que son plafond tolère : si un refus survient malgré cela,
  // il vient de la MATRICE, et de rien d'autre.
  rooms:      { update: { admin:1, manager:1, chef:1, responsible:0, technician:0, visitor:0 },
                delete: { admin:1, manager:1, chef:0, responsible:0, technician:0, visitor:0 } },
  baies:      { update: { admin:1, manager:1, chef:1, responsible:0, technician:0, visitor:0 },
                delete: { admin:1, manager:1, chef:0, responsible:0, technician:0, visitor:0 } },
  equipments: { update: { admin:1, manager:1, chef:1, responsible:1, technician:0, visitor:0 },
                delete: { admin:1, manager:1, chef:0, responsible:0, technician:0, visitor:0 } }
};

for (const store of ['rooms', 'baies', 'equipments']) {
  for (const action of ['update', 'delete']) {
    test(`ACL·${store}.${action} — chaque rôle suit EXACTEMENT la matrice canonique`, async () => {
      const { access } = decor();
      for (const { cle, user } of ROLES) {
        const autorise = await access.canAccessRecord(user, store, FICHE[store], action);
        assert.equal(autorise, Boolean(ATTENDU[store][action][cle]),
          `${cle} · ${store}.${action} : la matrice dit ${ATTENDU[store][action][cle] ? 'OUI' : 'NON'}`);
      }
    });
  }
}

/* ═══════════ les trois refus que la revue a nommés, isolés et nommés ═══════════ */

test('ACL·chef — édite, mais ne supprime NI salle NI baie NI équipement', async () => {
  const { access } = decor();
  const chef = { id: 'u-chef', role: 'chef' };
  for (const store of ['rooms', 'baies', 'equipments']) {
    assert.equal(await access.canAccessRecord(chef, store, FICHE[store], 'update'), true,
      `le chef DOIT pouvoir éditer ${store} — la matrice lui donne edit:true`);
    assert.equal(await access.canAccessRecord(chef, store, FICHE[store], 'delete'), false,
      `le chef NE DOIT PAS supprimer ${store} — la matrice lui donne delete:false`);
  }
});

test('ACL·responsable — édite son équipement, jamais une salle, ne supprime rien', async () => {
  const { access } = decor();
  const resp = { id: 'u-resp', role: 'responsible' };
  assert.equal(await access.canAccessRecord(resp, 'equipments', FICHE.equipments, 'update'), true,
    'la matrice ET son plafond lui accordent l’édition d’équipement');
  assert.equal(await access.canAccessRecord(resp, 'rooms', FICHE.rooms, 'update'), false,
    '`room.edit` est exclu de son plafond : aucune habilitation ne peut le lui rendre');
  assert.equal(await access.canAccessRecord(resp, 'equipments', FICHE.equipments, 'delete'), false,
    'la matrice lui refuse la suppression, et c’est elle qui décide de cet acte');
  assert.equal(await access.canAccessRecord(resp, 'baies', FICHE.baies, 'delete'), false);
});

test('ACL·technicien et visiteur — aucune suppression, sur aucun des trois types', async () => {
  const { access } = decor();
  for (const user of [{ id: 'u-tech', role: 'technicien' }, { id: 'u-visit', role: 'visiteur' }]) {
    for (const store of ['rooms', 'baies', 'equipments']) {
      assert.equal(await access.canAccessRecord(user, store, FICHE[store], 'delete'), false,
        `${user.role} ne doit supprimer ni salle, ni baie, ni équipement`);
    }
  }
});

test('ACL·visiteur — n’écrit rien du tout : son plafond ne porte aucune écriture', async () => {
  const { access } = decor();
  const visiteur = { id: 'u-visit', role: 'visiteur' };
  for (const store of ['rooms', 'baies', 'equipments']) {
    assert.equal(await access.canAccessRecord(visiteur, store, FICHE[store], 'update'), false);
  }
});

test('ACL·une habilitation de zone N’ÉLÈVE PAS le rôle qui la reçoit', async () => {
  /*
   * LA RÈGLE QUI COMPTE LE PLUS ICI. Le technicien de cette scène porte `equipment.edit`
   * ET `room.edit` sur sa zone — tout ce que son plafond tolère. La matrice lui déclare
   * pourtant `equipments.edit:false`. Une habilitation délègue DANS un périmètre ; elle ne
   * transforme pas un technicien en chef. Sans cette épreuve, il suffirait d'accorder une
   * habilitation pour contourner la matrice.
   */
  const { access } = decor();
  const technicien = { id: 'u-tech', role: 'technicien' };
  for (const action of ['update', 'delete']) {
    assert.equal(await access.canAccessRecord(technicien, 'equipments', FICHE.equipments, action), false,
      `l’habilitation de zone ne doit pas ouvrir ${action} à un rôle que la matrice refuse`);
    assert.equal(await access.canAccessRecord(technicien, 'baies', FICHE.baies, action), false);
  }
  // Et la LECTURE, elle, reste bien ouverte par l'habilitation : la garde ne ferme que les mutations.
  assert.equal(await access.canAccessRecord(technicien, 'equipments', FICHE.equipments, 'read'), true,
    'un technicien habilité doit continuer à LIRE les équipements de sa zone');
});

test('ACL·le refus de rôle et le refus de zone se distinguent', async () => {
  const { access } = decor();
  // `roleAllowsStoreAction` est la décision que la route utilise pour NOMMER le refus.
  assert.equal(access.roleAllowsStoreAction({ id: 'u-tech', role: 'technicien' }, 'equipments', 'update'), false,
    'refus de rôle : la route doit pouvoir répondre ROLE_ACTION_FORBIDDEN');
  assert.equal(access.roleAllowsStoreAction({ id: 'u-chef', role: 'chef' }, 'equipments', 'update'), true,
    'le chef passe la matrice : un refus éventuel ne viendrait alors que de la zone');
  assert.equal(access.roleAllowsStoreAction({ id: 'u-chef', role: 'chef' }, 'equipments', 'delete'), false);
  assert.equal(access.roleAllowsStoreAction({ id: 'u-admin', role: 'admin' }, 'cables', 'delete'), true,
    'un magasin que la matrice ne gouverne pas n’est pas refusé par cette garde');
});

test('ACL·lecture — inchangée : les six rôles lisent toujours ce que leur périmètre autorise', async () => {
  // La garde neuve ne touche QUE les mutations. Une régression de lecture rendrait la
  // carte vide pour les rôles à périmètre : c'est ce que cette épreuve empêche.
  const { access } = decor();
  for (const { user } of ROLES) {
    assert.equal(await access.canAccessRecord(user, 'rooms', FICHE.rooms, 'read'), true,
      `${user.role} doit continuer à LIRE la salle de sa zone`);
  }
});

/* ═══════ murs et écrans : même raccourci, même fermeture ═══════ */

test('ACL·murs et écrans — la suppression suit la matrice, l’édition reste déléguable', async () => {
  const { access } = decor();
  const chef = { id: 'u-chef', role: 'chef' };
  const mur = { id: 'w1', roomId: 'r1' };
  const ecran = { id: 's1', roomId: 'r1' };
  for (const [store, fiche] of [['walls', mur], ['screens', ecran]]) {
    assert.equal(await access.canAccessRecord(chef, store, fiche, 'update'), true,
      `chef · ${store}.edit vaut true dans la matrice`);
    assert.equal(await access.canAccessRecord(chef, store, fiche, 'delete'), false,
      `chef · ${store}.delete vaut false dans la matrice — et la matrice décide de cet acte`);
  }
});
