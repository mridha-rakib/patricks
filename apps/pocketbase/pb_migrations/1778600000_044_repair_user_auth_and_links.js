/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("users");

  collection.authRule = "";
  if (collection.passwordAuth) {
    collection.passwordAuth.enabled = true;
  }
  app.save(collection);

  const records = app.findAllRecords("users");
  for (const record of records) {
    if (!String(record.get("user_id") || "").trim()) {
      record.set("user_id", record.id);
      app.save(record);
    }
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId("users");

  collection.authRule = "";
  if (collection.passwordAuth) {
    collection.passwordAuth.enabled = true;
  }
  app.save(collection);
})
