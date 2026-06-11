/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const ensureTextField = (collection, name, { max = 0 } = {}) => {
    const existing = collection.fields.getByName(name);
    if (existing) {
      if (existing.type === "text") return false;
      collection.fields.removeByName(name);
    }

    collection.fields.add(new TextField({
      name,
      required: false,
      max,
      min: 0,
      pattern: "",
    }));
    return true;
  };

  const ensureSelectField = (collection, name, values) => {
    const existing = collection.fields.getByName(name);
    if (existing) {
      if (existing.type === "select") {
        existing.values = values;
        existing.maxSelect = 1;
        existing.required = false;
        return true;
      }
      collection.fields.removeByName(name);
    }

    collection.fields.add(new SelectField({
      name,
      required: false,
      maxSelect: 1,
      values,
    }));
    return true;
  };

  const ensureJsonField = (collection, name) => {
    const existing = collection.fields.getByName(name);
    if (existing) {
      if (existing.type === "json") return false;
      collection.fields.removeByName(name);
    }

    collection.fields.add(new JSONField({
      name,
      required: false,
      maxSize: 0,
    }));
    return true;
  };

  const ensureImagesField = (collection) => {
    const existing = collection.fields.getByName("images");
    if (existing) {
      if (existing.type === "file") {
        existing.maxSelect = 6;
        existing.maxSize = 20971520;
        existing.mimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
        return true;
      }
      collection.fields.removeByName("images");
    }

    collection.fields.add(new FileField({
      name: "images",
      required: false,
      maxSelect: 6,
      maxSize: 20971520,
      mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      thumbs: [],
    }));
    return true;
  };

  for (const collectionName of ["products", "shop_products"]) {
    const collection = app.findCollectionByNameOrId(collectionName);
    let changed = false;

    changed = ensureImagesField(collection) || changed;
    changed = ensureTextField(collection, "brand", { max: 160 }) || changed;
    changed = ensureTextField(collection, "location", { max: 160 }) || changed;
    changed = ensureSelectField(collection, "shipping_type", ["dhl_parcel", "letter_mail", "pickup"]) || changed;
    changed = ensureJsonField(collection, "filter_values") || changed;

    if (changed) {
      app.save(collection);
    }
  }
}, (app) => {
  for (const collectionName of ["products", "shop_products"]) {
    const collection = app.findCollectionByNameOrId(collectionName);
    let changed = false;

    for (const fieldName of ["images", "brand", "location", "shipping_type", "filter_values"]) {
      const existing = collection.fields.getByName(fieldName);
      if (existing) {
        collection.fields.removeByName(fieldName);
        changed = true;
      }
    }

    if (changed) {
      app.save(collection);
    }
  }
})
