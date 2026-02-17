export const toJson = (value = null) => {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

export const fromJson = (value = null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const upsertUserNotification = async (db, payload) => {
  const {
    userId,
    eventKey,
    loanId = null,
    kind,
    title,
    message,
    payloadJson = null,
    actionType = null,
    actionTargetId = null
  } = payload;

  if (!userId || !eventKey || !kind || !title || !message) return null;
  const now = new Date();
  return db.userNotification.upsert({
    where: {
      userId_eventKey: {
        userId,
        eventKey
      }
    },
    create: {
      userId,
      loanId,
      eventKey,
      kind,
      title,
      message,
      payloadJson,
      actionType,
      actionTargetId,
      status: 'DELIVERED',
      deliveredAt: now
    },
    update: {
      loanId,
      kind,
      title,
      message,
      payloadJson,
      actionType,
      actionTargetId,
      status: 'DELIVERED',
      deliveredAt: now,
      retryCount: 0,
      lastError: null
    }
  });
};

export const formatNotification = (row) => ({
  id: row.id,
  eventKey: row.eventKey,
  kind: row.kind,
  title: row.title,
  message: row.message,
  payload: fromJson(row.payloadJson),
  actionType: row.actionType || null,
  actionTargetId: row.actionTargetId || null,
  status: row.status,
  deliveredAt: row.deliveredAt,
  readAt: row.readAt,
  archivedAt: row.archivedAt,
  deletedAt: row.deletedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});
