import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const productSettings = sqliteTable("product_settings", {
  id: text("id").primaryKey(), priceMinor: integer("price_minor"), stock: integer("stock"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false), updatedAt: text("updated_at").notNull(),
});
export const storeSettings = sqliteTable("store_settings", {
  id: text("id").primaryKey(), value: text("value").notNull(), updatedAt: text("updated_at").notNull(),
});
export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(), idempotencyKey: text("idempotency_key").notNull().unique(), requestHash: text("request_hash").notNull(),
  accessToken: text("access_token").notNull(), callbackToken: text("callback_token").notNull(), status: text("status").notNull().default("creating"),
  fulfillmentStatus: text("fulfillment_status").notNull().default("unfulfilled"), customerJson: text("customer_json").notNull(),
  subtotalMinor: integer("subtotal_minor").notNull(), deliveryMinor: integer("delivery_minor").notNull(), totalMinor: integer("total_minor").notNull(),
  paymentId: text("payment_id").unique(), paymentUrl: text("payment_url"), transactionId: text("transaction_id").unique(), paymentMode: text("payment_mode").notNull(),
  tracking: text("tracking"), reservationReleased: integer("reservation_released", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [index("orders_created_idx").on(table.createdAt)]);
export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(), orderId: text("order_id").notNull().references(() => orders.id), productId: text("product_id").notNull(),
  name: text("name").notNull(), quantity: integer("quantity").notNull(), unitPriceMinor: integer("unit_price_minor").notNull(),
}, (table) => [index("order_items_order_idx").on(table.orderId)]);
export const paymentEvents = sqliteTable("payment_events", {
  id: text("id").primaryKey(), orderId: text("order_id").notNull().references(() => orders.id), event: text("event").notNull(), providerCode: text("provider_code"), createdAt: text("created_at").notNull(),
});
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(), count: integer("count").notNull(), expiresAt: integer("expires_at").notNull(),
});
