import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ArrowRight,
  Check,
  CircleAlert,
  ClipboardList,
  Gift,
  Loader2,
  MapPin,
  PackageSearch,
  Send,
  ShoppingCart,
  Sparkles,
  Truck,
  Zap,
  ExternalLink,
  Moon,
  Sun,
  MessageSquare,
  Wrench,
} from 'lucide-react';
import CartPanel from './components/CartPanel';
import ProductCard from './components/ProductCard';
import TrackOrderResult from './components/TrackOrderResult';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const STORAGE_KEYS = {
  cart: 'kapruka-agent-cart',
  checkout: 'kapruka-agent-checkout',
  theme: 'theme',
};

function getInitialMessages() {
  const savedName = localStorage.getItem('kapruka-user-name');
  const greeting = savedName ? `Hi **${savedName}**! 👋` : 'ආයුබෝවන්! 🙏';
  return [
    {
      role: 'assistant',
      content: `${greeting} I'm **Senehasa** — your Kapruka shopping buddy. I fluently understand **English**, **Sinhala** (සිංහල), and **Tanglish/Singlish**!\n\nWhether you're grabbing groceries, hunting for electronics, picking out a birthday cake, or sending flowers across Sri Lanka — tell me what you need and I'll sort it out for you! ✨`,
      timestamp: new Date().toISOString(),
    },
  ];
}

const quickPrompts = [
  { text: '🎁 Gift for my friend in Colombo under LKR 5000', icon: 'gift' },
  { text: '🍫 Kolombo walata choclet hampur ekak ona', icon: 'gift' },
  { text: '🌸 යාළුවාට කොළඹට මල් එකක් ඕනේ', icon: 'cake' },
  { text: 'Birthday cake for Colombo tomorrow under LKR 6000', icon: 'cake' },
  { text: '🎂 අම්මාගේ උපන්දිනේට කේක් එකක් (LKR 6000ට අඩු)', icon: 'cake' },
  { text: 'I need a good phone charger under LKR 3000', icon: 'zap' },
  { text: 'Weekly grocery essentials for home', icon: 'cart' },
  { text: 'Track my Kapruka order', icon: 'track' },
];

const initialCheckout = {
  recipientName: '',
  recipientPhone: '',
  recipientAddress: '',
  city: '',
  deliveryDate: '',
  senderName: '',
  senderPhone: '',
  senderEmail: '',
  giftMessage: '',
};

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function apiUrl(path) {
  const base = String(API_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}${path}` : path;
}

async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawText);
    } catch (error) {
      throw new Error(`Server said it was JSON, but the body could not be parsed: ${error.message}`);
    }
  }

  const trimmed = rawText.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<')) {
    throw new Error(
      'The app reached an HTML page instead of the Kapruka API. Make sure the backend is running and VITE_API_BASE_URL points to it, or that your dev server is proxying /api requests.',
    );
  }

  return { text: trimmed };
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanAssistantText(value = '') {
  return String(value || '')
    .replace(/Error\s*\(order_not_found\):\s*/gi, '')
    .replace(/order_not_found/gi, '')
    .replace(/\$_\.\*/g, '')
    .trim();
}

function friendlyTrackError(message = '') {
  const cleaned = cleanAssistantText(message);
  if (/order\s*not\s*found|no order exists|could not find/i.test(cleaned)) {
    return 'I could not find that order number. Please double-check it and try again.';
  }
  return cleaned || 'I could not find that order number. Please double-check it and try again.';
}

function renderMarkdown(value) {
  const cleaned = cleanAssistantText(value || '');
  return escapeHtml(cleaned)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br />');
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function cartQuantity(cartItems) {
  return cartItems.reduce((total, item) => total + item.quantity, 0);
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function formatDeliverySummary(result = {}) {
  const payload = result.data && typeof result.data === 'object' ? result.data : parseMaybeJson(result.text);
  const source = payload && typeof payload === 'object' ? payload : result;

  return {
    city: source.resolvedCity || source.city || result.resolvedCity || '',
    checkedDate: source.checked_date || source.delivery_date || source.date || '',
    available: typeof source.available === 'boolean' ? source.available : null,
    rate: source.rate ?? source.delivery_rate ?? source.price ?? null,
    currency: source.currency || 'LKR',
    warning: source.perishable_warning || source.warning || '',
    note: source.note || source.message || '',
  };
}

function extractCityHint(text = '') {
  const cities = ['Colombo', 'Kandy', 'Galle', 'Jaffna', 'Negombo', 'Matara', 'Kurunegala', 'Gampaha', 'Kalutara', 'Anuradhapura', 'Nuwara Eliya', 'Ratnapura', 'Batticaloa', 'Trincomalee'];
  return cities.find((city) => new RegExp(`\\b${city}\\b`, 'i').test(text)) || '';
}

function extractDateHint(text = '') {
  const normalized = text.toLowerCase();
  const today = new Date();
  if (/\btomorrow\b/.test(normalized)) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  }
  if (/\btoday\b/.test(normalized)) return today.toISOString().slice(0, 10);
  const match = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return match?.[1] || '';
}

function App() {
  const [messages, setMessages] = useState(() => getInitialMessages());
  const [userName, setUserName] = useState(() => localStorage.getItem('kapruka-user-name') || '');
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('kapruka-user-name'));
  const [isEnteringSite, setIsEnteringSite] = useState(false);
  const [welcomeNameInput, setWelcomeNameInput] = useState(() => localStorage.getItem('kapruka-user-name') || '');
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [cartItems, setCartItems] = useState(() => readStorage(STORAGE_KEYS.cart, []));
  const [checkoutDetails, setCheckoutDetails] = useState(() => readStorage(STORAGE_KEYS.checkout, initialCheckout));
  const [checkoutState, setCheckoutState] = useState({ status: 'idle', result: null, error: '' });
  const [trackNumber, setTrackNumber] = useState('');
  const [trackState, setTrackState] = useState({ status: 'idle', result: null, error: '' });
  const [deliveryState, setDeliveryState] = useState({ status: 'idle', result: null, error: '' });
  const [lastProducts, setLastProducts] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEYS.theme) || 'dark');
  const [activeTab, setActiveTab] = useState('chat');

  const messagesEndRef = useRef(null);
  const toastIdRef = useRef(0);

  const totalLKR = useMemo(
    () => cartItems.reduce((sum, item) => sum + (Number(item.priceLKR || 0) * item.quantity), 0),
    [cartItems],
  );
  const deliverySummary = useMemo(() => formatDeliverySummary(deliveryState.result || {}), [deliveryState.result]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(cartItems));
  }, [cartItems]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.checkout, JSON.stringify(checkoutDetails));
  }, [checkoutDetails]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const showToast = useCallback((text) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const updateCheckoutField = useCallback((field, value) => {
    setCheckoutDetails((prev) => ({ ...prev, [field]: value }));
  }, []);

  const addAssistantMessage = (content, extra = {}) => {
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content, timestamp: new Date().toISOString(), ...extra },
    ]);
  };

  const handleAddToCart = (product) => {
    setCartItems((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) => (
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        ));
      }
      return [...prev, { ...product, quantity: 1 }];
    });

    showToast(`Added ${product.name} to cart`);
    addAssistantMessage(`Added **${product.name}** to the cart. Share the delivery city and date when you are ready, and I will check availability before checkout.`);
  };

  const updateQuantity = (productId, quantity) => {
    setCartItems((prev) => prev
      .map((item) => (item.id === productId ? { ...item, quantity: Math.max(1, quantity) } : item))
      .filter((item) => item.quantity > 0));
  };

  const removeFromCart = (productId) => {
    setCartItems((prev) => prev.filter((item) => item.id !== productId));
    showToast('Item removed from cart');
  };

  const applyDeliveryHint = (field, value) => {
    updateCheckoutField(field, value);
    showToast(field === 'city' ? `Delivery city set to ${value}` : `Delivery date set to ${value}`);
  };

  const sendMessage = async (messageText = input) => {
    const trimmed = typeof messageText === 'string' ? messageText.trim() : messageText.text?.trim();
    if (!trimmed || isTyping) return;

    const cityHint = extractCityHint(trimmed);
    const dateHint = extractDateHint(trimmed);
    if (cityHint || dateHint) {
      setCheckoutDetails((prev) => ({
        ...prev,
        city: cityHint || prev.city,
        deliveryDate: dateHint || prev.deliveryDate,
      }));
    }

    const userMessage = { role: 'user', content: trimmed, timestamp: new Date().toISOString() };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInput('');
    setIsTyping(true);

    try {
      const response = await fetch(apiUrl('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          context: {
            userName: userName || '',
            cart: cartItems.map((item) => ({
              product_id: item.product_id || item.id,
              name: item.name,
              quantity: item.quantity,
              priceLKR: item.priceLKR,
            })),
            checkoutDetails,
          },
        }),
      });

      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(data.content || data.detail || data.error || 'Chat request failed');
      }

      const products = Array.isArray(data.products) ? data.products : [];
      if (products.length) setLastProducts(products);

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: cleanAssistantText(data.content || 'I found an update from Kapruka, but it did not include text.'),
          products,
          toolResults: data.toolResults || [],
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      addAssistantMessage(cleanAssistantText(error.message || 'I could not reach the live Kapruka shopping tools just now. Please try again.'));
    } finally {
      setIsTyping(false);
    }
  };

  const handleCheckout = async () => {
    setCheckoutState({ status: 'loading', result: null, error: '' });

    try {
      const response = await fetch(apiUrl('/api/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart: cartItems.map((item) => ({
            product_id: item.product_id || item.id,
            quantity: item.quantity,
          })),
          recipient: {
            name: checkoutDetails.recipientName,
            phone: checkoutDetails.recipientPhone,
            address: checkoutDetails.recipientAddress,
          },
          delivery: {
            city: checkoutDetails.city,
            address: checkoutDetails.recipientAddress,
            delivery_date: checkoutDetails.deliveryDate,
          },
          sender: {
            name: checkoutDetails.senderName,
            phone: checkoutDetails.senderPhone,
            email: checkoutDetails.senderEmail,
          },
          gift_message: checkoutDetails.giftMessage,
          currency: 'LKR',
        }),
      });

      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.detail || data.error || 'Checkout failed');

      setCheckoutState({ status: 'success', result: data, error: '' });
      showToast('Checkout ready!');
      addAssistantMessage(data.paymentUrl
        ? `Your guest checkout is ready. [Open checkout to pay](${data.paymentUrl})`
        : 'Kapruka created the checkout response, but I could not find a payment URL in it. Please review the checkout panel response.');
    } catch (error) {
      setCheckoutState({ status: 'error', result: null, error: error.message });
      addAssistantMessage(`Checkout could not be completed yet: ${error.message}`);
    }
  };

  const handleTrackOrder = async () => {
    const orderNumber = trackNumber.trim();
    if (!orderNumber) return;

    setTrackState({ status: 'loading', result: null, error: '' });

    try {
      const response = await fetch(apiUrl('/api/track'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_number: orderNumber }),
      });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.detail || data.error || 'Tracking failed');

      setTrackState({ status: 'success', result: data, error: '' });
      addAssistantMessage(`I pulled the status for order **#${orderNumber}**. You can view the structured timeline and delivery details in the Track Order panel on the right! 📦✨`);
    } catch (error) {
      setTrackState({ status: 'error', result: null, error: friendlyTrackError(error.message) });
    }
  };

  const handleCheckDelivery = async () => {
    const city = checkoutDetails.city.trim();
    const deliveryDate = checkoutDetails.deliveryDate.trim();

    if (!city || !deliveryDate) {
      setDeliveryState({
        status: 'error',
        result: null,
        error: 'Add a city and delivery date first.',
      });
      return;
    }

    setDeliveryState({ status: 'loading', result: null, error: '' });

    try {
      const response = await fetch(apiUrl('/api/delivery-check'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city,
          delivery_date: deliveryDate,
          product_id: cartItems[0]?.product_id || cartItems[0]?.id,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || 'Delivery check failed');

      setDeliveryState({ status: 'success', result: data, error: '' });
      const summary = formatDeliverySummary(data);
      const parts = [`I checked delivery for **${summary.city || data.resolvedCity || city}** on **${summary.checkedDate || deliveryDate}**.`];
      if (summary.available !== null) {
        parts.push(summary.available ? 'Delivery is available.' : 'Delivery is not available.');
      }
      if (summary.rate !== null && summary.rate !== undefined) {
        parts.push(`Rate: ${summary.currency} ${Number(summary.rate).toLocaleString()}.`);
      }
      if (summary.warning) {
        parts.push(summary.warning);
      } else if (summary.note) {
        parts.push(summary.note);
      }
      addAssistantMessage(parts.join(' '));
    } catch (error) {
      setDeliveryState({ status: 'error', result: null, error: error.message });
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img className="brand-logo" src="/senehasa-logo.svg" alt="Senehasa" />
          <div>
            <p className="eyebrow">Kapruka AI Shopping Agent</p>
            <h1>Senehasa</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="user-profile-badge" onClick={() => setShowWelcome(true)} title="Change your name">
            <span>👤 {userName ? `Hi, ${userName}` : 'Set Name'}</span>
          </button>
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <div className="status-pill hide-mobile">
            <span className="status-dot" />
            Live MCP
          </div>
        </div>
      </header>

      {showWelcome && (
        <div className="welcome-modal-overlay">
          <div className="welcome-modal-card">
            <div className="welcome-brand-badge">
              <Sparkles className="welcome-sparkle-icon" size={20} />
              <span>Kapruka AI Shopping Companion</span>
            </div>
            <h1 className="welcome-title">
              Welcome to <span>Senehasa</span>
            </h1>
            <p className="welcome-subtitle">
              Sri Lanka's premier AI e-commerce experience. Tell us your name so we can personalize your catalog discovery, gift recommendations, and islandwide delivery.
            </p>

            {isEnteringSite ? (
              <div className="welcome-loading-state">
                <Loader2 className="spinner welcome-spinner" size={36} />
                <p className="welcome-loading-text">Preparing your creative catalog, {welcomeNameInput || 'friend'}... ✨</p>
                <div className="welcome-progress-bar">
                  <div className="welcome-progress-fill" />
                </div>
              </div>
            ) : (
              <form
                className="welcome-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const nameToSave = welcomeNameInput.trim();
                  setIsEnteringSite(true);
                  setTimeout(() => {
                    if (nameToSave) {
                      localStorage.setItem('kapruka-user-name', nameToSave);
                      setUserName(nameToSave);
                      if (messages.length <= 1) {
                        setMessages([
                          {
                            role: 'assistant',
                            content: `Hi **${nameToSave}**! 👋 I'm **Senehasa** — your Kapruka shopping buddy. I fluently understand **English**, **Sinhala** (සිංහල), and **Tanglish/Singlish**!\n\nWhether you're grabbing groceries, hunting for electronics, picking out a birthday cake, or sending flowers across Sri Lanka — tell me what you need and I'll sort it out for you! ✨`,
                            timestamp: new Date().toISOString(),
                          },
                        ]);
                      }
                    } else {
                      localStorage.removeItem('kapruka-user-name');
                      setUserName('');
                    }
                    setIsEnteringSite(false);
                    setShowWelcome(false);
                  }, 1400);
                }}
              >
                <div className="welcome-input-wrapper">
                  <input
                    type="text"
                    className="welcome-input"
                    placeholder="Enter your name (e.g. Dilshan, Shalini)..."
                    value={welcomeNameInput}
                    onChange={(e) => setWelcomeNameInput(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="welcome-btn-group">
                  <button type="submit" className="welcome-primary-btn">
                    Launch Store <ArrowRight size={18} />
                  </button>
                  {userName && (
                    <button type="button" className="welcome-cancel-btn" onClick={() => setShowWelcome(false)}>
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <div className="tab-navigation">
        <button 
          className={activeTab === 'chat' ? 'tab-btn active' : 'tab-btn'} 
          onClick={() => setActiveTab('chat')}
        >
          <MessageSquare size={16} />
          Chat Agent
        </button>
        <button 
          className={activeTab === 'workspace' ? 'tab-btn active' : 'tab-btn'} 
          onClick={() => setActiveTab('workspace')}
        >
          <ShoppingCart size={16} />
          Workspace & Cart
        </button>
        <button 
          className={activeTab === 'track' ? 'tab-btn active' : 'tab-btn'} 
          onClick={() => setActiveTab('track')}
        >
          <ClipboardList size={16} />
          Track Order
        </button>
      </div>

      <main className={`main-content tab-${activeTab}`}>
        <section className="conversation-pane">
            <div className="chat-timeline" aria-live="polite">
              {messages.length <= 1 && (
                <div className="prompt-band">
                  <div>
                    <p className="eyebrow">Groceries · Electronics · Gifts · Fashion · Everything</p>
                    <h2>Just tell me what you need — I'll handle the rest.</h2>
                  </div>
                  <div className="prompt-grid">
                    {quickPrompts.map((prompt) => (
                      <button key={prompt.text} type="button" onClick={() => sendMessage(prompt.text)}>
                        <Sparkles size={15} />
                        {prompt.text}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message, index) => (
                <article key={`${message.timestamp}-${index}`} className={`message-row ${message.role}`}>
                  <div className="message-meta">
                    <span>{message.role === 'assistant' ? 'Senehasa' : 'You'}</span>
                    <time>{formatTime(message.timestamp)}</time>
                  </div>
                  <div className="message-bubble">
                    <div className="message-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
                    {message.products?.length > 0 && (
                      <div className="product-strip" aria-label="Product results">
                        {message.products.map((product) => (
                          <ProductCard key={product.id} product={product} onAddToCart={handleAddToCart} />
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}

              {isTyping && (
                <article className="message-row assistant">
                  <div className="message-meta">
                    <span>Senehasa</span>
                    <time>checking live tools</time>
                  </div>
                  <div className="typing-card">
                    <div className="typing-dots">
                      <span />
                      <span />
                      <span />
                    </div>
                    Searching Kapruka products, delivery, or checkout tools...
                  </div>
                </article>
              )}
              <div ref={messagesEndRef} />
            </div>

            <footer className="composer">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask for a gift, product, delivery city, date, checkout, or order tracking..."
                rows={2}
              />
              <button type="button" onClick={() => sendMessage()} disabled={!input.trim() || isTyping} aria-label="Send message">
                {isTyping ? <Loader2 size={20} /> : <Send size={20} />}
              </button>
            </footer>
        </section>

        <aside className="sidebar-pane">
          <section className="cart-pane">
            <div className="insight-grid">
              <div className="insight-card">
                <PackageSearch size={20} />
                <span>Live catalog</span>
                <strong>{lastProducts.length || 'Ready'}</strong>
              </div>
              <div className="insight-card">
                <Truck size={20} />
                <span>Delivery</span>
                <strong>{checkoutDetails.city || 'Set city'}</strong>
              </div>
              <div className="insight-card">
                <Gift size={20} />
                <span>Cart total</span>
                <strong>LKR {totalLKR.toLocaleString()}</strong>
              </div>
            </div>

            <section className="delivery-strip" aria-label="Delivery details">
              <div className="delivery-strip-copy">
                <p className="eyebrow">Delivery details</p>
                <h3>Set city and date first for fresh items.</h3>
              </div>
              <div className="delivery-strip-fields">
                <label>
                  City
                  <input
                    value={checkoutDetails.city}
                    onChange={(event) => updateCheckoutField('city', event.target.value)}
                    placeholder="Colombo"
                  />
                </label>
                <label>
                  Delivery date
                  <input
                    type="date"
                    value={checkoutDetails.deliveryDate}
                    onChange={(event) => updateCheckoutField('deliveryDate', event.target.value)}
                  />
                </label>
              </div>
              <div className="delivery-strip-chips">
                {['Colombo', 'Kandy', 'Galle', 'Jaffna'].map((city) => (
                  <button key={city} type="button" onClick={() => applyDeliveryHint('city', city)}>
                    {city}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    applyDeliveryHint('deliveryDate', tomorrow.toISOString().slice(0, 10));
                  }}
                >
                  Tomorrow
                </button>
              </div>
            </section>

            <CartPanel
              cartItems={cartItems}
              checkoutDetails={checkoutDetails}
              checkoutState={checkoutState}
              onCheckoutDetailsChange={setCheckoutDetails}
              onQuantityChange={updateQuantity}
              onRemoveItem={removeFromCart}
              onCheckout={handleCheckout}
            />
          </section>

          <section className="tools-pane">
            {lastProducts.length > 0 && (
              <section className="side-section">
                <div className="section-heading">
                  <h2>Latest Finds</h2>
                  <button type="button" onClick={() => { sendMessage('Show me more like these products'); }}>
                    More <ArrowRight size={15} />
                  </button>
                </div>
                <div className="mini-product-list">
                  {lastProducts.slice(0, 3).map((product) => (
                    <ProductCard key={`side-${product.id}`} product={product} onAddToCart={handleAddToCart} compact />
                  ))}
                </div>
              </section>
            )}



            <section className="side-section delivery-check-panel">
              <div className="section-heading">
                <h2>Delivery Check</h2>
                <Truck size={18} />
              </div>
              <p className="delivery-check-copy">Use the city and date from checkout to confirm live delivery availability before you pay.</p>
              <button type="button" className="delivery-check-button" onClick={handleCheckDelivery} disabled={deliveryState.status === 'loading'}>
                {deliveryState.status === 'loading' ? <Loader2 size={16} /> : 'Check delivery'}
              </button>
              {deliveryState.error && (
                <p className="inline-error">
                  <CircleAlert size={15} />
                  {deliveryState.error}
                </p>
              )}
              {deliveryState.status === 'success' && deliveryState.result && (
                <div className="delivery-result-card">
                  <div className="delivery-result-row">
                    <span>City</span>
                    <strong>{deliverySummary.city || 'Unknown'}</strong>
                  </div>
                  <div className="delivery-result-row">
                    <span>Date</span>
                    <strong>{deliverySummary.checkedDate || checkoutDetails.deliveryDate || 'Unknown'}</strong>
                  </div>
                  <div className="delivery-result-row">
                    <span>Availability</span>
                    <strong className={deliverySummary.available === false ? 'status-no' : 'status-yes'}>
                      {deliverySummary.available === null ? 'Checked' : deliverySummary.available ? 'Available' : 'Unavailable'}
                    </strong>
                  </div>
                  {deliverySummary.rate !== null && deliverySummary.rate !== undefined && (
                    <div className="delivery-result-row">
                      <span>Rate</span>
                      <strong>{deliverySummary.currency} {Number(deliverySummary.rate).toLocaleString()}</strong>
                    </div>
                  )}
                  {deliverySummary.warning && <p className="delivery-result-note">{deliverySummary.warning}</p>}
                  {!deliverySummary.warning && deliverySummary.note && <p className="delivery-result-note">{deliverySummary.note}</p>}
                </div>
              )}
            </section>

            <section className="side-section delivery-note">
              <MapPin size={18} />
              <p>Fresh items such as cakes and flowers should be checked against city and date before checkout.</p>
            </section>
          </section>
        </aside>

        <aside className="track-pane">
          <section className="side-section track-panel">
            <div className="section-heading">
              <h2>Track Order</h2>
              <ClipboardList size={18} />
            </div>
            <div className="track-form">
              <input
                value={trackNumber}
                onChange={(event) => setTrackNumber(event.target.value)}
                placeholder="Order number"
              />
              <button type="button" onClick={handleTrackOrder} disabled={!trackNumber.trim() || trackState.status === 'loading'}>
                {trackState.status === 'loading' ? <Loader2 size={16} /> : 'Track'}
              </button>
            </div>
            {trackState.error && (
              <p className="inline-error">
                <CircleAlert size={15} />
                {trackState.error}
              </p>
            )}
            {trackState.result && <TrackOrderResult result={trackState.result} />}
          </section>
        </aside>
      </main>

      <p className="app-credit" style={{ textAlign: 'center' }}>
        Built By <a href="https://nethumperera.github.io/portfolio/" target="_blank" rel="noreferrer">Nethum Perera</a>
      </p>

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className="toast">
              <Check size={16} />
              {toast.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
