import React from 'react';
import { CheckCircle2, Clock, Package, Truck, MapPin, Calendar, Gift, Phone, User, FileText } from 'lucide-react';
import './TrackOrderResult.css';

function cleanText(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/<[^>]*>?/gm, '').trim();
}

function getTrackingData(result) {
  if (!result) return null;
  if (typeof result.data === 'object' && result.data !== null && !Array.isArray(result.data)) {
    return result.data;
  }
  if (typeof result.raw === 'object' && result.raw !== null && !Array.isArray(result.raw)) {
    return result.raw;
  }
  if (typeof result.text === 'string') {
    try {
      const parsed = JSON.parse(result.text);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch (e) {
      // not JSON
    }
  }
  return null;
}

function getStatusIcon(status = '') {
  const lower = status.toLowerCase();
  if (lower.includes('deliver')) return <CheckCircle2 size={16} className="status-icon success" />;
  if (lower.includes('ship') || lower.includes('transit') || lower.includes('out')) return <Truck size={16} className="status-icon active" />;
  if (lower.includes('prepar') || lower.includes('warehous') || lower.includes('process')) return <Package size={16} className="status-icon active" />;
  return <Clock size={16} className="status-icon pending" />;
}

function TrackOrderResult({ result }) {
  const data = getTrackingData(result);

  if (!data) {
    // Fallback if not valid JSON tracking structure
    return (
      <div className="track-result-fallback">
        <FileText size={18} />
        <p>{result?.text || 'No tracking information returned.'}</p>
      </div>
    );
  }

  const statusDisplay = cleanText(data.status_display || data.status || 'In Progress');
  const isDelivered = statusDisplay.toLowerCase().includes('deliver');
  const orderNumber = cleanText(data.order_number || 'Unknown');
  const amountVal = data.amount?.value ? Number(data.amount.value).toLocaleString() : null;
  const currency = data.amount?.currency || 'LKR';

  const recipientName = cleanText(data.recipient?.name);
  const recipientPhone = cleanText(data.recipient?.phone);
  const recipientCity = cleanText(data.recipient?.city || data.city);
  const deliveryDate = cleanText(data.delivery_date);
  const greetingMsg = cleanText(data.greeting_message);

  const progressSteps = Array.isArray(data.progress) ? data.progress : [];

  return (
    <div className="track-order-card">
      {/* Header Bar */}
      <div className="track-card-header">
        <div className="track-order-title">
          <span className="track-eyebrow">Order Summary</span>
          <h3>#{orderNumber}</h3>
        </div>
        <div className={`track-status-pill ${isDelivered ? 'delivered' : 'in-progress'}`}>
          {getStatusIcon(statusDisplay)}
          <span>{statusDisplay}</span>
        </div>
      </div>

      {/* Meta Info Grid */}
      <div className="track-meta-grid">
        {amountVal && (
          <div className="track-meta-item">
            <span className="meta-label">Total Amount</span>
            <strong className="meta-value accent">{currency} {amountVal}</strong>
          </div>
        )}
        {deliveryDate && (
          <div className="track-meta-item">
            <span className="meta-label"><Calendar size={13} /> Delivery Date</span>
            <strong className="meta-value">{deliveryDate}</strong>
          </div>
        )}
        {recipientName && (
          <div className="track-meta-item">
            <span className="meta-label"><User size={13} /> Recipient</span>
            <strong className="meta-value">{recipientName}</strong>
          </div>
        )}
        {recipientCity && (
          <div className="track-meta-item">
            <span className="meta-label"><MapPin size={13} /> City</span>
            <strong className="meta-value">{recipientCity}</strong>
          </div>
        )}
        {recipientPhone && (
          <div className="track-meta-item">
            <span className="meta-label"><Phone size={13} /> Phone</span>
            <strong className="meta-value">{recipientPhone}</strong>
          </div>
        )}
      </div>

      {/* Greeting Message */}
      {greetingMsg && (
        <div className="track-greeting-box">
          <div className="greeting-header">
            <Gift size={15} />
            <span>Gift Message</span>
          </div>
          <p>"{greetingMsg}"</p>
        </div>
      )}

      {/* Progress Timeline */}
      {progressSteps.length > 0 && (
        <div className="track-timeline-section">
          <h4>Tracking History</h4>
          <div className="track-timeline">
            {progressSteps.map((stepItem, index) => {
              const isLatest = index === progressSteps.length - 1;
              return (
                <div key={index} className={`timeline-step ${isLatest ? 'latest' : ''}`}>
                  <div className="timeline-marker">
                    <div className="marker-dot" />
                    {index < progressSteps.length - 1 && <div className="marker-line" />}
                  </div>
                  <div className="timeline-content">
                    <strong className="step-text">{cleanText(stepItem.step)}</strong>
                    {stepItem.timestamp && <span className="step-time">{cleanText(stepItem.timestamp)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default TrackOrderResult;
