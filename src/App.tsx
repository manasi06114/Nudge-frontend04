import { useEffect, useMemo, useState, useRef } from 'react'
import { Camera, Check, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { useOCR } from './hooks/useOCR'
import { scanWithText, scanWithImage } from './services/scanService'

type Product = {
  id: string
  name: string
  code: string
  category: string
  expiryDate: string
  quantity: number
  location: string
  createdAt: string
}

type AlertStage = '7d' | '3d' | '1d' | 'today' | 'overdue'

type AlertEntry = {
  stage: AlertStage
  productId: string
  label: string
  firedAt: string
}

type AlertLedger = Record<string, AlertStage[]>
type FilterMode = 'all' | 'attention' | 'today' | 'overdue' | 'fresh'
type SortMode = 'urgency' | 'name' | 'quantity'
type ScanStep = 'product' | 'expiry'

type ScanProductData = {
  brand: string | null
  product: string | null
}

type ScanExpiryData = {
  raw: string
  iso: string
  display: string
  isExpired: boolean
  daysUntilExpiry: number
}

type ScanResponse =
  | {
      success: true
      scanState: 'product'
      data: ScanProductData | null
      message?: string
    }
  | {
      success: true
      scanState: 'expiry'
      data: { expiry: ScanExpiryData } | null
      message?: string
    }
  | {
      success: false
      error: string
    }

const STORAGE_KEY = 'nudge.products'
const ALERT_STORAGE_KEY = 'nudge.alerts'
const LOW_STOCK_THRESHOLD = 5

const warningLabels: Record<AlertStage, string> = {
  '7d': 'enters the 7 day watch window',
  '3d': 'needs attention in 3 days',
  '1d': 'expires tomorrow',
  today: 'expires today',
  overdue: 'is past expiry',
}

const addDays = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)

  return date.toISOString().slice(0, 10)
}

const initialProducts: Product[] = [
  {
    id: 'demo-1',
    name: 'Greek Yogurt',
    code: 'NYG-4819',
    category: 'Dairy',
    expiryDate: addDays(1),
    quantity: 12,
    location: 'Cold room A',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'demo-2',
    name: 'Spinach Pack',
    code: 'VG-2407',
    category: 'Produce',
    expiryDate: addDays(3),
    quantity: 28,
    location: 'Rack 02',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'demo-3',
    name: 'Almond Milk',
    code: 'AML-9032',
    category: 'Beverage',
    expiryDate: addDays(12),
    quantity: 18,
    location: 'Aisle 4',
    createdAt: new Date().toISOString(),
  },
]

const readStoredProducts = () => {
  try {
    const storedProducts = window.localStorage.getItem(STORAGE_KEY)
    return storedProducts ? (JSON.parse(storedProducts) as Product[]) : initialProducts
  } catch {
    return initialProducts
  }
}

const readStoredAlertLedger = () => {
  try {
    const storedAlerts = window.localStorage.getItem(ALERT_STORAGE_KEY)
    return storedAlerts ? (JSON.parse(storedAlerts) as AlertLedger) : {}
  } catch {
    return {}
  }
}

const formatDate = (dateString: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${dateString}T00:00:00`))

const getDaysLeft = (expiryDate: string) => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const expiry = new Date(`${expiryDate}T00:00:00`)
  const diff = expiry.getTime() - today.getTime()

  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

const getStage = (daysLeft: number): AlertStage | null => {
  if (daysLeft < 0) return 'overdue'
  if (daysLeft === 0) return 'today'
  if (daysLeft === 1) return '1d'
  if (daysLeft === 3) return '3d'
  if (daysLeft === 7) return '7d'

  return null
}

const getStatusLabel = (daysLeft: number) => {
  if (daysLeft < 0) return `${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} overdue`
  if (daysLeft === 0) return 'Expires today'
  if (daysLeft === 1) return '1 day left'

  return `${daysLeft} days left`
}

const getSeverity = (daysLeft: number) => {
  if (daysLeft < 0) return 'critical'
  if (daysLeft <= 1) return 'urgent'
  if (daysLeft <= 3) return 'warning'
  if (daysLeft <= 7) return 'notice'

  return 'fresh'
}

const categories = ['Dairy', 'Produce', 'Medicine', 'Cosmetics', 'Beverage', 'Pantry']

const filterOptions: { label: string; value: FilterMode }[] = [
  { label: 'All', value: 'all' },
  { label: 'Needs action', value: 'attention' },
  { label: 'Today', value: 'today' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Fresh', value: 'fresh' },
]

const quickDateOptions = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
]

const escapeCsvValue = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`

const expiryRawToInputDate = (rawDate: string) => {
  const [day, month, year] = rawDate.split('/')
  return `${year}-${month}-${day}`
}

const getScannedProductName = ({ brand, product }: ScanProductData) => {
  const normalizedBrand = brand?.trim() || ''
  const normalizedProduct = product?.trim() || ''

  if (!normalizedBrand) return normalizedProduct
  if (!normalizedProduct) return normalizedBrand
  if (normalizedProduct.toLowerCase().includes(normalizedBrand.toLowerCase())) return normalizedProduct

  return `${normalizedBrand} ${normalizedProduct}`
}

const App = () => {
  const { extractText } = useOCR()
  const [products, setProducts] = useState<Product[]>(readStoredProducts)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [scanValue, setScanValue] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [category, setCategory] = useState(categories[0])
  const [location, setLocation] = useState('Shelf A')
  const [quantity, setQuantity] = useState('1')
  const [permissionState, setPermissionState] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  )
  const [alerts, setAlerts] = useState<AlertEntry[]>([])
  const [alertLedger, setAlertLedger] = useState<AlertLedger>(readStoredAlertLedger)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [sortMode, setSortMode] = useState<SortMode>('urgency')
  const [formMessage, setFormMessage] = useState('')
  const [copiedList, setCopiedList] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanStep, setScanStep] = useState<ScanStep>('product')
  const [scanImage, setScanImage] = useState<File | null>(null)
  const [scanPreview, setScanPreview] = useState('')
  const [scannedProduct, setScannedProduct] = useState<ScanProductData | null>(null)
  const [scanError, setScanError] = useState('')
  const [scanLoading, setScanLoading] = useState(false)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(products))
  }, [products])

  useEffect(() => {
    window.localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(alertLedger))
  }, [alertLedger])

  useEffect(
    () => () => {
      if (scanPreview) URL.revokeObjectURL(scanPreview)
    },
    [scanPreview],
  )

  useEffect(() => {
    document.body.style.overflow = scannerOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [scannerOpen])

  useEffect(() => {
    let activeStream: MediaStream | null = null

    const startCamera = async () => {
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        }
        const s = await navigator.mediaDevices.getUserMedia(constraints)
        activeStream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
        }
      } catch (err) {
        console.error('Camera access error:', err)
        setScanError('Could not access camera. Ensure you are using HTTPS and have granted camera permissions.')
      }
    }

    if (scannerOpen && !scanPreview) {
      startCamera()
    }

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop())
      }
    }
  }, [scannerOpen, scanPreview])

  const captureFrame = () => {
    if (!videoRef.current) return
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const file = new File([blob], `${scanStep}.jpg`, { type: 'image/jpeg' })
            handleScanImageChange(file)
            submitScan(file)
          }
        },
        'image/jpeg',
        0.92
      )
    }
  }

  const computedProducts = useMemo(
    () =>
      [...products]
        .map((product) => {
          const daysLeft = getDaysLeft(product.expiryDate)

          return {
            ...product,
            daysLeft,
            stage: getStage(daysLeft),
            severity: getSeverity(daysLeft),
          }
        })
        .sort((left, right) => left.daysLeft - right.daysLeft),
    [products],
  )

  const filteredProducts = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return computedProducts
      .filter((product) => {
        if (filterMode === 'attention') return product.daysLeft <= 3
        if (filterMode === 'today') return product.daysLeft === 0
        if (filterMode === 'overdue') return product.daysLeft < 0
        if (filterMode === 'fresh') return product.daysLeft > 7

        return true
      })
      .filter((product) => {
        if (!normalizedSearch) return true

        return [product.name, product.code, product.category, product.location]
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch)
      })
      .sort((left, right) => {
        if (sortMode === 'name') return left.name.localeCompare(right.name)
        if (sortMode === 'quantity') return left.quantity - right.quantity

        return left.daysLeft - right.daysLeft
      })
  }, [computedProducts, filterMode, searchTerm, sortMode])

  const dashboard = useMemo(() => {
    const total = computedProducts.length
    const expiringSoon = computedProducts.filter((product) => product.daysLeft >= 0 && product.daysLeft <= 3).length
    const overdue = computedProducts.filter((product) => product.daysLeft < 0).length
    const today = computedProducts.filter((product) => product.daysLeft === 0).length
    const safe = computedProducts.filter((product) => product.daysLeft > 7).length
    const lowStock = computedProducts.filter((product) => product.quantity <= LOW_STOCK_THRESHOLD).length

    return { total, expiringSoon, overdue, today, safe, lowStock }
  }, [computedProducts])

  const nextFocus = computedProducts[0]
  const actionQueue = computedProducts.filter((product) => product.daysLeft <= 3)
  const lowStockProducts = computedProducts.filter((product) => product.quantity <= LOW_STOCK_THRESHOLD)

  useEffect(() => {
    const syncAlerts = () => {
      const nextAlerts: AlertEntry[] = []
      const updatedLedger = { ...alertLedger }

      for (const product of computedProducts) {
        if (!product.stage) {
          continue
        }

        const firedStages = updatedLedger[product.id] ?? []

        if (firedStages.includes(product.stage)) {
          continue
        }

        const entry: AlertEntry = {
          productId: product.id,
          stage: product.stage,
          label: `${product.name} ${warningLabels[product.stage]}`,
          firedAt: new Date().toISOString(),
        }

        nextAlerts.push(entry)
        updatedLedger[product.id] = [...firedStages, product.stage]

        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const notificationTitle = product.stage === 'overdue' ? 'Nudge: product expired' : 'Nudge: expiry reminder'

          new Notification(notificationTitle, {
            body: `${product.name} - ${warningLabels[product.stage]} - ${formatDate(product.expiryDate)}`,
          })
        }
      }

      if (nextAlerts.length > 0) {
        setAlerts((currentAlerts) => [...nextAlerts, ...currentAlerts].slice(0, 8))
        setAlertLedger(updatedLedger)
      }
    }

    const initialSyncTimer = window.setTimeout(syncAlerts, 0)
    const intervalTimer = window.setInterval(syncAlerts, 60_000)

    return () => {
      window.clearTimeout(initialSyncTimer)
      window.clearInterval(intervalTimer)
    }
  }, [alertLedger, computedProducts])

  const handleAddProduct = () => {
    if (!scanValue.trim() || !expiryDate) {
      setFormMessage('Add a product name or scan code and choose an expiry date.')
      return
    }

    const cleanedValue = scanValue.trim()
    const nextProduct: Product = {
      id: crypto.randomUUID(),
      name: cleanedValue,
      code: cleanedValue.toUpperCase().replace(/\s+/g, '-'),
      category,
      expiryDate,
      quantity: Number(quantity) || 1,
      location: location.trim() || 'Unassigned',
      createdAt: new Date().toISOString(),
    }

    setProducts((currentProducts) => [nextProduct, ...currentProducts])
    setScanValue('')
    setExpiryDate('')
    setQuantity('1')
    setFormMessage(`${nextProduct.name} was added to the tracker.`)
  }

  const handlePermissionRequest = async () => {
    if (typeof Notification === 'undefined') {
      return
    }

    const nextPermission = await Notification.requestPermission()
    setPermissionState(nextPermission)
  }

  const handleRemoveProduct = (productId: string) => {
    setProducts((currentProducts) => currentProducts.filter((product) => product.id !== productId))
    setAlertLedger((currentLedger) => {
      const nextLedger = { ...currentLedger }
      delete nextLedger[productId]
      return nextLedger
    })
  }

  const handleQuantityChange = (productId: string, nextQuantity: number) => {
    setProducts((currentProducts) =>
      currentProducts.map((product) =>
        product.id === productId ? { ...product, quantity: Math.max(0, nextQuantity) } : product,
      ),
    )
  }

  const handleDuplicateProduct = (product: Product) => {
    setProducts((currentProducts) => [
      {
        ...product,
        id: crypto.randomUUID(),
        name: `${product.name} copy`,
        code: `${product.code}-COPY`,
        createdAt: new Date().toISOString(),
      },
      ...currentProducts,
    ])
  }

  const handleExportCsv = () => {
    const rows = [
      ['Name', 'Code', 'Category', 'Expiry date', 'Days left', 'Quantity', 'Location'],
      ...filteredProducts.map((product) => [
        product.name,
        product.code,
        product.category,
        product.expiryDate,
        String(product.daysLeft),
        String(product.quantity),
        product.location,
      ]),
    ]
    const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `nudge-inventory-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleCopyShoppingList = async () => {
    const listItems = lowStockProducts.map((product) => `${product.name} (${product.quantity} left)`).join('\n')

    if (!listItems) {
      setCopiedList(false)
      return
    }

    try {
      await navigator.clipboard.writeText(listItems)
      setCopiedList(true)
      window.setTimeout(() => setCopiedList(false), 1800)
    } catch {
      setCopiedList(false)
    }
  }

  const handleUseDemoScan = () => {
    setScanValue('Vitamin C Serum')
    setExpiryDate(addDays(7))
    setCategory('Cosmetics')
    setLocation('Display 03')
    setQuantity('6')
  }

  const clearScanImage = () => {
    if (scanPreview) URL.revokeObjectURL(scanPreview)
    setScanImage(null)
    setScanPreview('')
  }

  const resetScanner = () => {
    clearScanImage()
    setScanStep('product')
    setScannedProduct(null)
    setScanError('')
    setScanLoading(false)
  }

  const openScanner = () => {
    resetScanner()
    setScannerOpen(true)
  }

  const closeScanner = () => {
    if (scanLoading) return
    setScannerOpen(false)
    resetScanner()
  }

  const handleScanImageChange = (file: File | undefined) => {
    if (!file) return

    clearScanImage()
    setScanImage(file)
    setScanPreview(URL.createObjectURL(file))
    setScanError('')
  }

  const submitScan = async (fileToScan?: File) => {
    const file = fileToScan || scanImage
    if (!file || scanLoading) return

    setScanLoading(true)
    setScanError('')

    try {
      // Step 1: Try OCR locally first
      const ocr = await extractText(file)

      let result: ScanResponse

      if (ocr.isGoodEnough) {
        // OCR worked - use cheap text API
        result = await scanWithText(ocr.text, scanStep)
      } else {
        // OCR failed - fall back to vision API
        result = await scanWithImage(file, scanStep)
      }

      if (!result.success) {
        throw new Error(result.error || 'Could not analyze this image.')
      }

      if (!result.data) {
        setScanError(
          scanStep === 'product'
            ? 'The product name was not clear. Retake the front of the package in good light.'
            : 'The expiry date was not clear. Retake the printed date area closer and in focus.',
        )
        return
      }

      if (scanStep === 'product' && result.scanState === 'product') {
        const productName = getScannedProductName(result.data)
        if (!productName) {
          setScanError('The product name was not clear. Please take another photo.')
          return
        }

        setScannedProduct(result.data)
        setScanValue(productName)
        clearScanImage()
        setScanStep('expiry')
        return
      }

      if (scanStep === 'expiry' && result.scanState === 'expiry') {
        const productName = scannedProduct ? getScannedProductName(scannedProduct) : ''
        if (!productName) {
          setScanError('Product details were lost. Please restart this scan.')
          return
        }

        const scannedExpiryDate = expiryRawToInputDate(result.data.expiry.raw)
        const nextProduct: Product = {
          id: crypto.randomUUID(),
          name: productName,
          code: productName.toUpperCase().replace(/\s+/g, '-'),
          category,
          expiryDate: scannedExpiryDate,
          quantity: Number(quantity) || 1,
          location: location.trim() || 'Unassigned',
          createdAt: new Date().toISOString(),
        }

        setProducts((currentProducts) => [nextProduct, ...currentProducts])
        setExpiryDate(scannedExpiryDate)
        setFormMessage(`${nextProduct.name} was scanned and added to the tracker.`)
        setScannerOpen(false)
        resetScanner()
        window.setTimeout(() => {
          document.getElementById('inventory')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 100)
      }
    } catch (error) {
      setScanError(
        error instanceof TypeError
          ? 'Could not reach the scanner service. Make sure the backend is running.'
          : error instanceof Error
            ? error.message
            : 'Could not analyze this image. Please try again.',
      )
    } finally {
      setScanLoading(false)
    }
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Nudge home">
          <img src="/NUDGE%20LOGO.png" alt="NUDGE logo" />
          <span>NUDGE</span>
        </a>

        <nav aria-label="Primary navigation">
          <a href="#tracker">Tracker</a>
          <a href="#alerts">Alerts</a>
          <a href="#inventory">Inventory</a>
        </nav>

        <button className="topbar-action" type="button" onClick={handlePermissionRequest}>
          {permissionState === 'granted' ? 'Alerts on' : 'Enable alerts'}
        </button>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow">Expiry intelligence for every shelf</p>
            <h1>Nudge</h1>
            <p>
              Scan a product, save its expiry date, and keep your inventory moving before anything gets wasted,
              forgotten, or sold too late.
            </p>

            <div className="hero-actions">
              <button className="primary-link" type="button" onClick={openScanner}>
                Start scanning
              </button>
              <button className="ghost-button" type="button" onClick={handleUseDemoScan}>
                Fill demo scan
              </button>
            </div>
          </div>

          <div className="hero-console" aria-label="Nudge product snapshot">
            <div className="phone-frame">
              <div className="phone-header">
                <span />
                <strong>Nudge Scan</strong>
                <span />
              </div>
              <div className="scan-window">
                <div className="scan-line" />
                <div className="barcode">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </div>
              <div className="phone-card">
                <span>Next expiry</span>
                <strong>{nextFocus ? nextFocus.name : 'No product yet'}</strong>
                <small>{nextFocus ? getStatusLabel(nextFocus.daysLeft) : 'Ready to scan'}</small>
              </div>
            </div>

            <div className="floating-ticket ticket-alert">
              <span>Warning</span>
              <strong>{dashboard.expiringSoon + dashboard.overdue}</strong>
              <small>items need a nudge</small>
            </div>
            <div className="floating-ticket ticket-safe">
              <span>Clear</span>
              <strong>{dashboard.safe}</strong>
              <small>items are fresh</small>
            </div>
          </div>
        </section>

        <section className="command-center" aria-label="Operational focus">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Daily focus</p>
              <h2>What needs attention first</h2>
            </div>
            <button className="secondary-button" type="button" onClick={handleCopyShoppingList}>
              {copiedList ? 'Copied list' : 'Copy low-stock list'}
            </button>
          </div>

          <div className="focus-grid">
            <article className="focus-panel urgent-focus">
              <span>Priority queue</span>
              <strong>{actionQueue.length}</strong>
              <p>{nextFocus ? `${nextFocus.name} - ${getStatusLabel(nextFocus.daysLeft)}` : 'No urgent products right now.'}</p>
            </article>
            <article className="focus-panel">
              <span>Low stock</span>
              <strong>{dashboard.lowStock}</strong>
              <p>
                {lowStockProducts.length > 0
                  ? lowStockProducts
                      .slice(0, 2)
                      .map((product) => product.name)
                      .join(', ')
                  : 'Inventory levels look steady.'}
              </p>
            </article>
            <article className="focus-panel">
              <span>Coverage</span>
              <strong>{dashboard.safe}</strong>
              <p>items have more than a week before expiry.</p>
            </article>
          </div>
        </section>

        <section className="summary-band" aria-label="Inventory summary">
          <article>
            <span>Total tracked</span>
            <strong>{dashboard.total}</strong>
          </article>
          <article>
            <span>Expiring soon</span>
            <strong>{dashboard.expiringSoon}</strong>
          </article>
          <article>
            <span>Due today</span>
            <strong>{dashboard.today}</strong>
          </article>
          <article>
            <span>Overdue</span>
            <strong>{dashboard.overdue}</strong>
          </article>
        </section>

        <section className="tracker-grid" id="tracker">
          <div className="tool-panel scanner-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Scanner intake</p>
                <h2>Capture product details</h2>
              </div>
              <span className="status-pill">Auto sorted</span>
            </div>

            <div className="scanner-form">
              <button className="scan-launch-button field-wide" type="button" onClick={openScanner}>
                <Camera size={20} aria-hidden="true" />
                Scan product with camera
              </button>

              <div className="scan-divider field-wide">
                <span>or add manually</span>
              </div>

              <label className="field-wide">
                <span>Product scan</span>
                <input
                  type="text"
                  placeholder="Barcode, batch code, or product name"
                  value={scanValue}
                  onChange={(event) => setScanValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleAddProduct()
                    }
                  }}
                />
              </label>

              <label>
                <span>Expiry date</span>
                <input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} />
              </label>

              <div className="quick-dates field-wide" aria-label="Quick expiry date presets">
                {quickDateOptions.map((option) => (
                  <button key={option.label} type="button" onClick={() => setExpiryDate(addDays(option.days))}>
                    {option.label}
                  </button>
                ))}
              </div>

              <label>
                <span>Category</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  {categories.map((categoryOption) => (
                    <option key={categoryOption}>{categoryOption}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Quantity</span>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>

              <label>
                <span>Location</span>
                <input type="text" value={location} onChange={(event) => setLocation(event.target.value)} />
              </label>

              <button className="add-button field-wide" type="button" onClick={handleAddProduct}>
                Add to expiry list
              </button>

              {formMessage ? <p className="form-message field-wide">{formMessage}</p> : null}
            </div>
          </div>

          <aside className="tool-panel alert-panel" id="alerts">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Live warnings</p>
                <h2>Notification feed</h2>
              </div>
              <span className="status-pill subtle">{permissionState}</span>
            </div>

            <div className="alert-feed">
              {alerts.length === 0 ? (
                <div className="empty-state compact">
                  <p>Warnings will appear here when products enter the 7, 3, 1, today, or overdue window.</p>
                </div>
              ) : (
                alerts.map((alert) => (
                  <article className={`alert-entry ${alert.stage}`} key={`${alert.productId}-${alert.stage}`}>
                    <span>{warningLabels[alert.stage]}</span>
                    <strong>{alert.label}</strong>
                    <small>
                      {new Date(alert.firedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </small>
                  </article>
                ))
              )}
            </div>
          </aside>
        </section>

        <section className="inventory-section" id="inventory">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Expiry list</p>
              <h2>Products sorted by urgency</h2>
            </div>
            <div className="inventory-actions">
              <span className="status-pill">{filteredProducts.length} shown</span>
              <button className="secondary-button" type="button" onClick={handleExportCsv} disabled={filteredProducts.length === 0}>
                Export CSV
              </button>
            </div>
          </div>

          <div className="inventory-toolbar" aria-label="Inventory tools">
            <label className="search-field">
              <span>Search</span>
              <input
                type="search"
                placeholder="Find by name, code, category, or location"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>

            <label>
              <span>Sort</span>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="urgency">Urgency</option>
                <option value="name">Name</option>
                <option value="quantity">Quantity</option>
              </select>
            </label>

            <div className="filter-tabs" role="tablist" aria-label="Filter products">
              {filterOptions.map((option) => (
                <button
                  aria-selected={filterMode === option.value}
                  className={filterMode === option.value ? 'active' : ''}
                  key={option.value}
                  onClick={() => setFilterMode(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="product-list">
            {filteredProducts.length === 0 ? (
              <div className="empty-state">
                <p>No products match this view.</p>
                <span>Try clearing search or switching filters.</span>
              </div>
            ) : (
              filteredProducts.map((product) => (
                <article className={`product-row ${product.severity}`} key={product.id}>
                  <div className="product-status" aria-hidden="true" />

                  <div className="product-main">
                    <span>{product.category}</span>
                    <h3>{product.name}</h3>
                    <p>
                      {product.code} / Qty {product.quantity} / {product.location}
                    </p>
                    {product.quantity <= LOW_STOCK_THRESHOLD ? <em>Low stock</em> : null}
                  </div>

                  <div className="product-meta">
                    <span>{formatDate(product.expiryDate)}</span>
                    <strong>{getStatusLabel(product.daysLeft)}</strong>
                  </div>

                  <div className="row-actions">
                    <button
                      aria-label={`Use one ${product.name}`}
                      className="icon-button"
                      type="button"
                      onClick={() => handleQuantityChange(product.id, product.quantity - 1)}
                    >
                      -
                    </button>
                    <button
                      aria-label={`Restock ${product.name}`}
                      className="icon-button"
                      type="button"
                      onClick={() => handleQuantityChange(product.id, product.quantity + 1)}
                    >
                      +
                    </button>
                    <button type="button" className="remove-button" onClick={() => handleDuplicateProduct(product)}>
                      Copy
                    </button>
                    <button type="button" className="remove-button danger" onClick={() => handleRemoveProduct(product.id)}>
                      Remove
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </main>

      <button
        className="bottom-camera-button"
        type="button"
        onClick={openScanner}
        aria-label="Open camera scanner"
      >
        <span className="bottom-camera-button-inner">
          <Camera size={27} strokeWidth={2.4} aria-hidden="true" />
        </span>
      </button>

      {scannerOpen ? (
        <div className="scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
          <div className="scanner-dialog">
            <div className="scanner-dialog-header">
              <div>
                <p className="eyebrow">Camera scan</p>
                <h2 id="scanner-title">{scanStep === 'product' ? 'Show the product front' : 'Show the expiry date'}</h2>
              </div>
              <button className="scanner-close" type="button" onClick={closeScanner} aria-label="Close scanner">
                <X size={22} />
              </button>
            </div>

            <div className="scan-progress" aria-label={`Step ${scanStep === 'product' ? 1 : 2} of 2`}>
              <div className="scan-progress-item complete">
                <span>{scanStep === 'expiry' ? <Check size={16} /> : '1'}</span>
                <strong>Product</strong>
              </div>
              <div className="scan-progress-line" data-complete={scanStep === 'expiry'} />
              <div className={`scan-progress-item ${scanStep === 'expiry' ? 'active' : ''}`}>
                <span>2</span>
                <strong>Expiry</strong>
              </div>
            </div>

            {scanStep === 'expiry' && scannedProduct ? (
              <div className="recognized-product">
                <Check size={18} aria-hidden="true" />
                <div>
                  <span>Product recognized</span>
                  <strong>{getScannedProductName(scannedProduct)}</strong>
                </div>
              </div>
            ) : (
              <p className="scanner-guidance">
                Keep the brand and product name inside the frame. Use good light and avoid glare.
              </p>
            )}

            {scanStep === 'expiry' ? (
              <p className="scanner-guidance">
                Find the EXP, use-by, or best-before print and take a close, focused photo.
              </p>
            ) : null}

            <div className={`camera-capture-container ${scanPreview ? 'has-preview' : ''}`}>
              {scanPreview ? (
                <img src={scanPreview} className="camera-preview-img" alt={`${scanStep} capture preview`} />
              ) : (
                <div className="video-stream-wrapper">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="camera-video-stream"
                  />
                  <div className="camera-overlay-box">
                    <div className="scanner-target-reticle" />
                  </div>
                  <button type="button" className="capture-shutter-button" onClick={captureFrame} aria-label="Capture photo">
                    <span className="shutter-inner" />
                  </button>
                </div>
              )}
            </div>

            {scanError ? <p className="scanner-error">{scanError}</p> : null}

            <div className="scanner-actions">
              {scanImage ? (
                <button className="secondary-button" type="button" onClick={clearScanImage} disabled={scanLoading}>
                  <RotateCcw size={17} aria-hidden="true" />
                  Retake
                </button>
              ) : null}
              <button className="add-button" type="button" onClick={() => submitScan()} disabled={!scanImage || scanLoading}>
                {scanLoading ? <LoaderCircle className="scanner-spinner" size={19} /> : <Camera size={19} />}
                {scanLoading
                  ? 'Reading image...'
                  : scanStep === 'product'
                    ? 'Read product'
                    : 'Read expiry & add'}
              </button>
            </div>

            <p className="scanner-transaction-note">
              Nothing is added until both the product and expiry date are successfully read.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
