/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("admin_settings");
  const existing = collection.fields.getByName("shop_enabled");

  if (!existing) {
    collection.fields.add(new BoolField({
      name: "shop_enabled",
      required: false
    }));
    app.save(collection);
  }

  const records = app.findRecordsByFilter("admin_settings", "", "", 100, 0);
  for (const record of records) {
    record.set("shop_enabled", false);
    app.save(record);
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId("admin_settings");
  const existing = collection.fields.getByName("shop_enabled");

  if (existing) {
    collection.fields.removeByName("shop_enabled");
    app.save(collection);
  }
})
