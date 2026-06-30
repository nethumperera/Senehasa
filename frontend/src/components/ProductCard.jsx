import { ExternalLink, Info, Plus, ShoppingBag } from 'lucide-react';
import './ProductCard.css';

function ProductCard({ product, onAddToCart, compact = false }) {
  const price = Number(product.priceLKR || 0);
  const hasImage = Boolean(product.image);

  return (
    <article className={`product-card ${compact ? 'compact' : ''} ${!product.inStock ? 'out-of-stock' : ''}`}>
      <div className="product-image-container">
        {hasImage ? (
          <img src={product.image} alt={product.name} className="product-image" loading="lazy" />
        ) : (
          <div className="product-image-placeholder">
            <ShoppingBag size={28} />
          </div>
        )}
        {product.isFresh && <span className="product-badge">Fresh date check</span>}
        {!product.inStock && <span className="product-badge sold-out">Sold out</span>}
      </div>

      <div className="product-details">
        <p className="product-category">{product.category || 'Kapruka'}</p>
        <h3>{product.name}</h3>
        <div className="product-price">
          <strong>{price > 0 ? `LKR ${price.toLocaleString()}` : 'Price from Kapruka'}</strong>
          {product.priceUSD ? <span>USD {Number(product.priceUSD).toFixed(2)}</span> : null}
        </div>

        {product.isFresh && !compact && (
          <p className="fresh-warning">
            <Info size={14} />
            Check city and delivery date before checkout.
          </p>
        )}

        <div className="product-actions">
          <button type="button" onClick={() => onAddToCart(product)} disabled={!product.inStock}>
            <Plus size={16} />
            Add
          </button>
          {product.url && (
            <a href={product.url} target="_blank" rel="noreferrer" aria-label={`Open ${product.name} on Kapruka`}>
              <ExternalLink size={16} />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export default ProductCard;
