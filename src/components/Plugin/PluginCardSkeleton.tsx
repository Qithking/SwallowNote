/**
 * PluginCardSkeleton — Loading placeholder for plugin cards.
 *
 * Renders a pulsing skeleton that mimics the shape of a plugin card
 * while data is being loaded.
 */
export function PluginCardSkeleton() {
  return (
    <div
      className="pa-market-card"
      style={{
        opacity: 0.6,
        pointerEvents: 'none',
      }}
    >
      <div className="pa-market-card-spine" style={{ background: 'var(--pa-line)' }} />
      <div className="pa-market-card-body">
        <div className="pa-market-card-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                height: 16,
                width: '60%',
                background: 'var(--pa-line)',
                borderRadius: 4,
                marginBottom: 6,
              }}
            />
            <div
              style={{
                height: 10,
                width: '40%',
                background: 'var(--pa-line)',
                borderRadius: 3,
              }}
            />
          </div>
          <span
            className="pa-market-badge"
            style={{ background: 'var(--pa-line)', color: 'transparent' }}
          >
            loading
          </span>
        </div>
        <div
          style={{
            height: 10,
            width: '80%',
            background: 'var(--pa-line)',
            borderRadius: 3,
            marginTop: 8,
          }}
        />
        <div className="pa-market-card-meta" style={{ marginTop: 12 }}>
          <span className="pa-market-badge" style={{ background: 'var(--pa-line)' }}>
            &nbsp;&nbsp;&nbsp;
          </span>
          <span className="pa-market-badge" style={{ background: 'var(--pa-line)' }}>
            &nbsp;&nbsp;&nbsp;
          </span>
        </div>
      </div>
    </div>
  )
}

export function PluginCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <PluginCardSkeleton key={i} />
      ))}
    </>
  )
}
