import { CircleAlert, CreditCard, Loader2, Minus, Plus, Trash2 } from 'lucide-react';
import './CartPanel.css';

const requiredCheckoutFields = [
  'recipientName',
  'recipientPhone',
  'recipientAddress',
  'city',
  'deliveryDate',
  'senderName',
  'senderPhone',
  'senderEmail',
];

const quickGiftMessages = [
  '🎂 Happy Birthday! Wishing you all the happiness!',
  '🌸 සුභ උපන්දිනක් වේවා! ආදරයෙන්... ❤️',
  '❤️ Thinking of you always! Lots of love across the miles.',
  '🌟 Congratulations! So proud of you! ✨',
];

function CartPanel({
  cartItems,
  checkoutDetails,
  checkoutState,
  onCheckoutDetailsChange,
  onQuantityChange,
  onRemoveItem,
  onCheckout,
}) {
  const totalLKR = cartItems.reduce((sum, item) => sum + (Number(item.priceLKR || 0) * item.quantity), 0);
  const missingFields = requiredCheckoutFields.filter((field) => !String(checkoutDetails[field] || '').trim());
  const canCheckout = cartItems.length > 0 && missingFields.length === 0 && checkoutState.status !== 'loading';

  const updateField = (field, value) => {
    onCheckoutDetailsChange((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <section className="cart-panel">
      <div className="cart-header">
        <div>
          <p className="eyebrow">Checkout workspace</p>
          <h2>Cart & Delivery</h2>
        </div>
        <strong>LKR {totalLKR.toLocaleString()}</strong>
      </div>

      <div className="cart-items">
        {cartItems.length === 0 ? (
          <div className="empty-cart">
            <p>Your cart is waiting. Ask Senehasa for a product or add one from the live results.</p>
          </div>
        ) : (
          cartItems.map((item) => (
            <article key={item.id} className="cart-item">
              {item.image ? <img src={item.image} alt={item.name} /> : <div className="cart-image-placeholder" />}
              <div className="cart-item-body">
                <h3>{item.name}</h3>
                <p>LKR {Number(item.priceLKR || 0).toLocaleString()}</p>
                <div className="quantity-row">
                  <button type="button" onClick={() => onQuantityChange(item.id, item.quantity - 1)} aria-label="Decrease quantity">
                    <Minus size={14} />
                  </button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => onQuantityChange(item.id, item.quantity + 1)} aria-label="Increase quantity">
                    <Plus size={14} />
                  </button>
                  <button type="button" className="remove-item" onClick={() => onRemoveItem(item.id)} aria-label="Remove item">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      <div className="checkout-form">
        <div className="form-row two">
          <label>
            Recipient
            <input value={checkoutDetails.recipientName} onChange={(event) => updateField('recipientName', event.target.value)} placeholder="Name" />
          </label>
          <label>
            Phone
            <input value={checkoutDetails.recipientPhone} onChange={(event) => updateField('recipientPhone', event.target.value)} placeholder="07..." />
          </label>
        </div>

        <label>
          Delivery address
          <input value={checkoutDetails.recipientAddress} onChange={(event) => updateField('recipientAddress', event.target.value)} placeholder="Street, apartment, landmark" />
        </label>

        <div className="form-row two">
          <label>
            City
            <input value={checkoutDetails.city} onChange={(event) => updateField('city', event.target.value)} placeholder="Colombo" />
          </label>
          <label>
            Date
            <input type="date" value={checkoutDetails.deliveryDate} onChange={(event) => updateField('deliveryDate', event.target.value)} />
          </label>
        </div>

        <div className="form-row two">
          <label>
            Sender
            <input value={checkoutDetails.senderName} onChange={(event) => updateField('senderName', event.target.value)} placeholder="Your name" />
          </label>
          <label>
            Sender phone
            <input value={checkoutDetails.senderPhone} onChange={(event) => updateField('senderPhone', event.target.value)} placeholder="Phone" />
          </label>
        </div>

        <label>
          Sender email
          <input type="email" value={checkoutDetails.senderEmail} onChange={(event) => updateField('senderEmail', event.target.value)} placeholder="name@example.com" />
        </label>

        <div className="gift-message-container">
          <label>
            Gift message <span className="gift-hint">(✨ One-click suggestions)</span>
            <textarea value={checkoutDetails.giftMessage} onChange={(event) => updateField('giftMessage', event.target.value)} placeholder="Optional message for the recipient" rows={3} />
          </label>
          <div className="gift-pills">
            {quickGiftMessages.map((msg) => (
              <button key={msg} type="button" className="gift-pill-btn" onClick={() => updateField('giftMessage', msg)}>
                {msg}
              </button>
            ))}
          </div>
        </div>
      </div>

      {missingFields.length > 0 && cartItems.length > 0 && (
        <p className="checkout-warning">
          <CircleAlert size={15} />
          Add recipient, delivery, and sender details before creating a payment link.
        </p>
      )}

      <button className="checkout-button" type="button" onClick={onCheckout} disabled={!canCheckout}>
        {checkoutState.status === 'loading' ? <Loader2 size={18} /> : <CreditCard size={18} />}
        Create Guest Checkout
      </button>

      {checkoutState.status === 'success' && checkoutState.result && (
        <div className="checkout-result">
          <strong>Checkout ready</strong>
          {checkoutState.result.paymentUrl ? (
            <a href={checkoutState.result.paymentUrl} target="_blank" rel="noreferrer">
              Open secure payment link
            </a>
          ) : (
            <p>Payment link was not returned. Check the raw response in the chat.</p>
          )}
          {checkoutState.result.orderNumber && <p>Order: {checkoutState.result.orderNumber}</p>}
        </div>
      )}

      {checkoutState.status === 'error' && (
        <p className="checkout-warning">
          <CircleAlert size={15} />
          {checkoutState.error}
        </p>
      )}
    </section>
  );
}

export default CartPanel;
