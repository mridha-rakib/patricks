/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const products = app.findCollectionByNameOrId("products");
  let productsChanged = false;

  const images = products.fields.getByName("images");
  if (images && images.type === "file") {
    images.maxSelect = 6;
    productsChanged = true;
  }

  const status = products.fields.getByName("status");
  if (status && status.type === "select") {
    const values = ["draft", "active", "pending_verification", "rejected", "sold"];
    status.values = values;
    productsChanged = true;
  }

  const verificationStatus = products.fields.getByName("verification_status");
  if (verificationStatus && verificationStatus.type === "select") {
    verificationStatus.values = ["pending", "pending_payment", "approved", "rejected", "needs_correction", "not_required"];
    productsChanged = true;
  }

  if (productsChanged) {
    app.save(products);
  }

  const verifications = app.findCollectionByNameOrId("product_verifications");
  const verificationStatusAudit = verifications.fields.getByName("status");
  if (verificationStatusAudit && verificationStatusAudit.type === "select") {
    verificationStatusAudit.values = ["pending", "approved", "rejected", "needs_correction"];
    app.save(verifications);
  }
}, (app) => {
  const products = app.findCollectionByNameOrId("products");
  let productsChanged = false;

  const images = products.fields.getByName("images");
  if (images && images.type === "file") {
    images.maxSelect = 5;
    productsChanged = true;
  }

  const verificationStatus = products.fields.getByName("verification_status");
  if (verificationStatus && verificationStatus.type === "select") {
    verificationStatus.values = ["pending", "approved", "rejected"];
    productsChanged = true;
  }

  if (productsChanged) {
    app.save(products);
  }

  const verifications = app.findCollectionByNameOrId("product_verifications");
  const verificationStatusAudit = verifications.fields.getByName("status");
  if (verificationStatusAudit && verificationStatusAudit.type === "select") {
    verificationStatusAudit.values = ["pending", "approved", "rejected"];
    app.save(verifications);
  }
})
