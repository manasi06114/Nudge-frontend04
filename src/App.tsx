import { useEffect, useMemo, useState, useRef } from 'react'
import { Camera, Check, LoaderCircle, LogOut, RotateCcw, X, Home, Library, Bell, HelpCircle, Download } from 'lucide-react'
import { useOCR } from './hooks/useOCR'
import { scanWithText, scanWithImage } from './services/scanService'
import { supabase } from './services/supabase'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import {
  fetchProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} from './services/productService'

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

type FilterMode = 'all' | 'attention' | 'today' | 'overdue' | 'fresh'
type SortMode = 'urgency' | 'name' | 'quantity'
type ScanStep = 'product' | 'expiry'

type ScanProductData = {
  brand: string | null
  product: string | null
  category: string | null
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

const formatDate = (dateString: string) => {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(`${dateString}T00:00:00`))
  } catch {
    return dateString
  }
}

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

const defaultCategories = ['Dairy', 'Produce', 'Medicine', 'Cosmetics', 'Beverage', 'Pantry']

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

const AuthView = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password.trim()) {
      setError('Please fill in all fields.')
      return
    }
    setError('')
    setLoading(true)
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        })
        if (error) throw error
        alert('Verification email sent! Please check your inbox.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setError('')
    try {
      const isNative = Capacitor.isNativePlatform()
      const redirectTo = isNative ? 'nudgeapp://login-callback' : window.location.origin

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
        },
      })
      if (error) throw error
    } catch (err: any) {
      setError(err.message || 'Google Login failed.')
    }
  }

  return (
    <div className="site-shell" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '40px 20px' }}>
      <header className="topbar" style={{ position: 'relative', width: '100%', maxWidth: '440px', borderRadius: '16px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="brand" style={{ pointerEvents: 'none' }}>
          <img src="/NUDGE%20LOGO.png" alt="NUDGE logo" />
          <span>Nudge</span>
        </div>
        {!Capacitor.isNativePlatform() && (
          <a href="/Nudge.apk" download className="download-apk-btn" aria-label="Download APK for Android">
            <Download size={20} />
            <span className="tooltip-text">Download APK for Android</span>
          </a>
        )}
      </header>

      <main style={{ width: '100%', maxWidth: '440px', background: 'rgba(255, 255, 255, 0.9)', border: '1px solid rgba(84, 57, 105, 0.12)', borderRadius: '24px', padding: '32px', boxShadow: '0 20px 50px rgba(36, 20, 47, 0.15)', backdropFilter: 'blur(16px)' }}>
        <h2 style={{ color: '#24142f', fontSize: '1.8rem', fontWeight: 800, textAlign: 'center', marginBottom: '8px' }}>
          {isSignUp ? 'Create Account' : 'Welcome to Nudge'}
        </h2>
        <p style={{ color: '#8e7a9c', fontSize: '0.95rem', textAlign: 'center', marginBottom: '28px' }}>
          {isSignUp ? 'Sign up to start tracking your inventory.' : 'Sign in to access your cloud-synced shelf.'}
        </p>

        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#dc2626', padding: '12px 16px', borderRadius: '8px', fontSize: '0.9rem', marginBottom: '20px', fontWeight: 500 }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#543969', textTransform: 'uppercase' }}>Email Address</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(84, 57, 105, 0.15)', background: '#ffffff', fontSize: '0.95rem', color: '#24142f' }}
              required
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#543969', textTransform: 'uppercase' }}>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(84, 57, 105, 0.15)', background: '#ffffff', fontSize: '0.95rem', color: '#24142f' }}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{ marginTop: '10px', background: '#8e22da', color: '#ffffff', border: 0, padding: '14px', borderRadius: '12px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 6px 20px rgba(142, 34, 218, 0.25)' }}
          >
            {loading ? 'Processing...' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', margin: '24px 0', color: '#8e7a9c', fontSize: '0.85rem' }}>
          <span style={{ flex: 1, height: '1px', background: 'rgba(84, 57, 105, 0.1)' }} />
          <span style={{ padding: '0 12px', fontWeight: 600 }}>OR</span>
          <span style={{ flex: 1, height: '1px', background: 'rgba(84, 57, 105, 0.1)' }} />
        </div>

        <button
          onClick={handleGoogleLogin}
          type="button"
          style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(84, 57, 105, 0.15)', padding: '12px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', cursor: 'pointer', fontWeight: 600, color: '#24142f', boxShadow: '0 4px 12px rgba(36, 20, 47, 0.04)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        <p style={{ marginTop: '24px', textAlign: 'center', fontSize: '0.9rem', color: '#543969' }}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            type="button"
            style={{ background: 'none', border: 0, color: '#8e22da', fontWeight: 700, padding: 0, textDecoration: 'underline', cursor: 'pointer' }}
          >
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </main>
    </div>
  )
}

const UserProfileAvatar = ({ session }: { session: any }) => {
  const [imgFailed, setImgFailed] = useState(false)
  const avatarUrl = session?.user?.user_metadata?.avatar_url
  const email = session?.user?.email || 'User'
  const initial = email[0].toUpperCase()

  const getBackgroundColor = (str: string) => {
    const colors = [
      '#8e22da',
      '#e056fd',
      '#686de0',
      '#30336b',
      '#ff7979',
      '#ff9f43',
      '#1dd1a1',
      '#0984e3'
    ]
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash)
    }
    const index = Math.abs(hash) % colors.length
    return colors[index]
  }

  const bgColor = getBackgroundColor(email)

  if (avatarUrl && !imgFailed) {
    return (
      <img
        src={avatarUrl}
        alt="User profile"
        onError={() => setImgFailed(true)}
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          border: '2px solid #8e22da',
          objectFit: 'cover'
        }}
      />
    )
  }

  return (
    <div style={{
      width: '32px',
      height: '32px',
      borderRadius: '50%',
      background: bgColor,
      color: '#ffffff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 'bold',
      fontSize: '0.95rem',
      border: `2px solid ${bgColor}`
    }}>
      {initial}
    </div>
  )
}

const App = () => {
  const { extractText } = useOCR()
  const [session, setSession] = useState<any>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [products, setProducts] = useState<Product[]>([])

  const [activeTab, setActiveTab] = useState<'home' | 'shelf' | 'notifications' | 'help'>('home')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [scanValue, setScanValue] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [category, setCategory] = useState(defaultCategories[0])
  const [location, setLocation] = useState('Shelf A')
  const [quantity, setQuantity] = useState('1')
  const permissionState = typeof Notification !== 'undefined' ? Notification.permission : 'default'
  const [searchTerm, setSearchTerm] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [sortMode, setSortMode] = useState<SortMode>('urgency')
  const [formMessage, setFormMessage] = useState('')

  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanStep, setScanStep] = useState<ScanStep>('product')
  const [scanImage, setScanImage] = useState<File | null>(null)
  const [scanPreview, setScanPreview] = useState('')
  const [scannedProduct, setScannedProduct] = useState<ScanProductData | null>(null)
  const [scanError, setScanError] = useState('')
  const [scanLoading, setScanLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    // Listen for deep link events when app is opened via custom scheme (mobile OAuth redirect)
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('appUrlOpen', async (data: { url: string }) => {
        const urlStr = data.url.replace('nudgeapp://login-callback', window.location.origin)
        const url = new URL(urlStr)
        const hash = url.hash
        if (hash) {
          const params = new URLSearchParams(hash.substring(1))
          const accessToken = params.get('access_token')
          const refreshToken = params.get('refresh_token')
          if (accessToken && refreshToken) {
            setAuthLoading(true)
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })
            if (error) {
              console.error('Error setting session from deep link:', error.message)
            }
            setAuthLoading(false)
          }
        }
      })
    }

    return () => {
      subscription.unsubscribe()
      if (Capacitor.isNativePlatform()) {
        CapApp.removeAllListeners()
      }
    }
  }, [])

  const loadProducts = async () => {
    try {
      const list = await fetchProducts()
      const mapped: Product[] = list.map((item) => ({
        id: item.id,
        name: item.name,
        code: item.code || '',
        category: item.category || 'Pantry',
        expiryDate: item.expiry_date,
        quantity: item.quantity,
        location: item.location || 'Unassigned',
        createdAt: item.created_at,
      }))
      setProducts(mapped)
    } catch (err) {
      console.error('Failed to load products from database:', err)
    }
  }

  useEffect(() => {
    if (session) {
      loadProducts()
    } else {
      setProducts([])
    }
  }, [session])

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

  const notificationProducts = useMemo(() => {
    return computedProducts.filter((p) => p.daysLeft <= 14)
  }, [computedProducts])



  const handleRemoveProduct = async (productId: string) => {
    try {
      await deleteProduct(productId)
      await loadProducts()
    } catch (err) {
      console.error('Failed to delete product:', err)
    }
  }

  const handleQuantityChange = async (productId: string, nextQuantity: number) => {
    try {
      await updateProduct(productId, { quantity: Math.max(0, nextQuantity) })
      await loadProducts()
    } catch (err) {
      console.error('Failed to change product quantity:', err)
    }
  }

  const handleDuplicateProduct = async (product: Product) => {
    try {
      await createProduct({
        name: product.name,
        code: `${product.code}-COPY`,
        category: product.category,
        expiryDate: product.expiryDate,
        quantity: product.quantity,
        location: product.location,
      })
      await loadProducts()
    } catch (err) {
      console.error('Failed to duplicate product:', err)
    }
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
      console.log('OCR STARTED FOR FILE:', file.name, 'SIZE:', file.size);
      const ocr = await extractText(file)
      console.log('OCR RESULT:', JSON.stringify(ocr));
      let result: ScanResponse

      if (ocr.isGoodEnough) {
        console.log('OCR CONFIDENCE GOOD. CALLING scanWithText WITH TEXT:', ocr.text);
        result = await scanWithText(ocr.text, scanStep)
      } else {
        console.log('OCR CONFIDENCE LOW OR FAILED. FALLING BACK TO scanWithImage WITH FILE SIZE:', file.size);
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
        if (result.data.category) {
          setCategory(result.data.category)
        }
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

        const created = await createProduct({
          name: productName,
          code: productName.toUpperCase().replace(/\s+/g, '-'),
          category,
          expiryDate: scannedExpiryDate,
          quantity: Number(quantity) || 1,
          location: location.trim() || 'Unassigned',
        })

        await loadProducts()
        setExpiryDate(scannedExpiryDate)
        setFormMessage(`${created.name} was scanned and added to the tracker.`)
        setScannerOpen(false)
        resetScanner()
        window.setTimeout(() => {
          document.getElementById('inventory')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 100)
      }
    } catch (error) {
      console.error("FULL SCAN ERROR:", error);

      if (error instanceof Error) {
        console.error("ERROR NAME:", error.name);
        console.error("ERROR MESSAGE:", error.message);
        console.error("ERROR STACK:", error.stack);
      }

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

  const handleAddProduct = async () => {
    if (!scanValue.trim() || !expiryDate) {
      setFormMessage('Add a product name or scan code and choose an expiry date.')
      return
    }

    const cleanedValue = scanValue.trim()
    try {
      await createProduct({
        name: cleanedValue,
        code: cleanedValue.toUpperCase().replace(/\s+/g, '-'),
        category,
        expiryDate,
        quantity: Number(quantity) || 1,
        location: location.trim() || 'Unassigned',
      })
      setScanValue('')
      setExpiryDate('')
      setQuantity('1')
      setFormMessage(`${cleanedValue} was added to the tracker.`)
      await loadProducts()
    } catch (err) {
      setFormMessage('Failed to add product.')
    }
  }

  const categoriesList = useMemo(() => {
    const unique = new Set(defaultCategories)
    for (const p of products) {
      if (p.category) {
        unique.add(p.category)
      }
    }
    return Array.from(unique)
  }, [products])

  const categoriesMap = useMemo(() => {
    const map: Record<string, typeof filteredProducts> = {}
    for (const product of filteredProducts) {
      const cat = product.category || 'Pantry'
      if (!map[cat]) {
        map[cat] = []
      }
      map[cat].push(product)
    }
    return map
  }, [filteredProducts])

  if (authLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'linear-gradient(135deg, rgba(155, 38, 220, 0.08), transparent 32%), linear-gradient(180deg, #ffffff 0%, #faf6ff 44%, #f8fbf7 100%)' }}>
        <LoaderCircle style={{ animation: 'spin 1s linear infinite', color: '#8e22da', width: '50px', height: '50px' }} />
        <p style={{ marginTop: '16px', color: '#543969', fontWeight: 600 }}>Loading Nudge...</p>
      </div>
    )
  }

  if (!session) {
    return <AuthView />
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Nudge home">
          <img src="/NUDGE%20LOGO.png" alt="NUDGE logo" />
          <span>Nudge</span>
        </a>

        <div className="topbar-account" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {!Capacitor.isNativePlatform() && (
            <a href="/Nudge.apk" download className="download-apk-btn" aria-label="Download APK for Android">
              <Download size={20} />
              <span className="tooltip-text">Download APK for Android</span>
            </a>
          )}
          <div className="user-profile-chip" style={{ display: 'flex', alignItems: 'center' }}>
            <UserProfileAvatar session={session} />
          </div>

          <button className="logout-button" type="button" aria-label="Log out" onClick={() => supabase.auth.signOut()}>
            <LogOut size={20} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main id="top">
        {activeTab === 'home' && (
          <>
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

            <section className="command-center" aria-label="Operational focus" style={{ marginTop: '28px' }}>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Urgent Alert Watchlist</p>
                  <h2>Nearest Expirations</h2>
                </div>
                <button className="secondary-button" type="button" onClick={() => setActiveTab('shelf')}>
                  View all shelf inventory
                </button>
              </div>

              <div className="product-list" style={{ marginTop: '16px' }}>
                {computedProducts.length === 0 ? (
                  <div className="empty-state">
                    <p>No products tracked yet.</p>
                    <span style={{ cursor: 'pointer', textDecoration: 'underline', color: '#8e22da' }} onClick={openScanner}>Click here to scan a product and get started!</span>
                  </div>
                ) : (
                  computedProducts.slice(0, 5).map((product) => (
                    <article className={`product-row ${product.severity}`} key={product.id}>
                      <div className="product-status" aria-hidden="true" />
                      <div className="product-main">
                        <span>{product.category}</span>
                        <h3>{product.name}</h3>
                        <p>
                          {product.code} / Qty {product.quantity} / {product.location}
                        </p>
                      </div>
                      <div className="product-meta">
                        <span>{formatDate(product.expiryDate)}</span>
                        <strong>{getStatusLabel(product.daysLeft)}</strong>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          </>
        )}

        {activeTab === 'shelf' && (
          <>
            <section className="tracker-grid" id="tracker" style={{ gridTemplateColumns: '1fr', margin: '28px 0' }}>
              <div className="tool-panel scanner-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Intake Form</p>
                    <h2>Add product manually</h2>
                  </div>
                  <button className="secondary-button" type="button" onClick={openScanner}>
                    Use Camera Scanner
                  </button>
                </div>

                <div className="scanner-form">
                  <label className="field-wide">
                    <span>Product name / Batch code</span>
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
                      {categoriesList.map((categoryOption) => (
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
            </section>

            <section className="inventory-section" id="inventory" style={{ margin: '28px 0 56px' }}>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Shelf List</p>
                  <h2>Category-wise Shelf Shelves</h2>
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

              <div className="product-list" style={{ display: 'grid', gap: '24px' }}>
                {filteredProducts.length === 0 ? (
                  <div className="empty-state">
                    <p>No products match this view.</p>
                    <span>Try clearing search or switching filters.</span>
                  </div>
                ) : (
                  Object.keys(categoriesMap).map((catName) => (
                    <div key={catName} className="category-shelf-panel" style={{
                      background: 'rgba(255, 255, 255, 0.7)',
                      border: '1px solid rgba(84, 57, 105, 0.12)',
                      borderRadius: '16px',
                      padding: '20px',
                      backdropFilter: 'blur(10px)',
                      boxShadow: '0 4px 20px rgba(36, 20, 47, 0.05)',
                    }}>
                      <h3 style={{
                        color: '#8e22da',
                        fontWeight: 800,
                        fontSize: '1.2rem',
                        marginBottom: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        borderBottom: '2px solid rgba(142, 34, 218, 0.1)',
                        paddingBottom: '8px'
                      }}>
                        <span>📂</span> {catName} <span style={{
                          fontSize: '0.85rem',
                          color: '#8e7a9c',
                          fontWeight: 500,
                          background: 'rgba(142, 34, 218, 0.08)',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          marginLeft: 'auto'
                        }}>{categoriesMap[catName].length} items</span>
                      </h3>

                      <div style={{ display: 'grid', gap: '12px' }}>
                        {categoriesMap[catName].map((product) => (
                          <article className={`product-row ${product.severity}`} key={product.id} style={{ margin: 0 }}>
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
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}

        {activeTab === 'notifications' && (
          <section className="tracker-grid" style={{ gridTemplateColumns: '1fr', margin: '28px 0 56px' }}>
            <aside className="tool-panel alert-panel" id="alerts" style={{ minHeight: '400px' }}>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Live warnings</p>
                  <h2>Notification Feed</h2>
                </div>
                <span className="status-pill subtle">{permissionState}</span>
              </div>

              <div className="alert-feed" style={{ display: 'grid', gap: '12px' }}>
                {notificationProducts.length === 0 ? (
                  <div className="empty-state" style={{ padding: '60px 20px' }}>
                    <p>No alerts received yet.</p>
                    <span>Warnings will appear here when products enter the 14-day watch windows.</span>
                  </div>
                ) : (
                  notificationProducts.map((product) => {
                    let displayStage: AlertStage = '7d'
                    if (product.daysLeft < 0) displayStage = 'overdue'
                    else if (product.daysLeft === 0) displayStage = 'today'
                    else if (product.daysLeft === 1) displayStage = '1d'
                    else if (product.daysLeft <= 3) displayStage = '3d'
                    else if (product.daysLeft <= 7) displayStage = '7d'

                    return (
                      <article className={`alert-entry ${displayStage}`} key={product.id} style={{ margin: 0 }}>
                        <span>{product.daysLeft < 0 ? 'Overdue' : `${product.daysLeft} days left`}</span>
                        <strong>{product.name} ({product.category}) - {warningLabels[displayStage]}</strong>
                        <small>
                          Expires on {formatDate(product.expiryDate)} / Qty: {product.quantity}
                        </small>
                      </article>
                    )
                  })
                )}
              </div>
            </aside>
          </section>
        )}

        {activeTab === 'help' && (
          <section className="tool-panel" style={{ margin: '28px 0 56px', minHeight: '450px' }}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Support & Guidelines</p>
                <h2>Help Center</h2>
              </div>
            </div>

            <div className="help-content-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', marginTop: '24px' }}>
              <div className="focus-panel" style={{ minHeight: 'auto' }}>
                <span style={{ color: '#8e22da', fontSize: '0.85rem' }}>Step 1</span>
                <h3 style={{ color: '#24142f', fontWeight: 800, fontSize: '1.2rem', margin: '10px 0 6px' }}>Product Capture</h3>
                <p style={{ fontSize: '0.94rem', color: '#5c5267', lineHeight: '1.5' }}>
                  Tap the camera icon in the bottom menu. Place the product name/logo clearly inside the frame and snap a photo.
                </p>
              </div>

              <div className="focus-panel" style={{ minHeight: 'auto' }}>
                <span style={{ color: '#8e22da', fontSize: '0.85rem' }}>Step 2</span>
                <h3 style={{ color: '#24142f', fontWeight: 800, fontSize: '1.2rem', margin: '10px 0 6px' }}>Date Intake</h3>
                <p style={{ fontSize: '0.94rem', color: '#5c5267', lineHeight: '1.5' }}>
                  Locate the expiration date print on the product, align it inside the reticle, and capture it. The AI will parse it.
                </p>
              </div>

              <div className="focus-panel" style={{ minHeight: 'auto' }}>
                <span style={{ color: '#8e22da', fontSize: '0.85rem' }}>Step 3</span>
                <h3 style={{ color: '#24142f', fontWeight: 800, fontSize: '1.2rem', margin: '10px 0 6px' }}>Alert Tracking</h3>
                <p style={{ fontSize: '0.94rem', color: '#5c5267', lineHeight: '1.5' }}>
                  Nudge triggers browser notifications automatically as dates approach (7d, 3d, 1d, same day, and overdue).
                </p>
              </div>
            </div>

            <div style={{ marginTop: '36px', padding: '24px', borderRadius: '8px', background: 'rgba(142, 34, 218, 0.05)', border: '1px solid rgba(142, 34, 218, 0.12)' }}>
              <h3 style={{ color: '#24142f', fontWeight: 800, marginBottom: '8px' }}>Need Additional Help?</h3>
              <p style={{ color: '#5c5267', fontSize: '0.95rem' }}>
                If you encounter any issues, need assistance, or want to suggest new features, please contact our support team.
              </p>
              <div style={{ marginTop: '16px' }}>
                <a href="mailto:pujarimanasi12345@gmail.com" className="primary-link" style={{ textDecoration: 'none', padding: '10px 20px', borderRadius: '6px', fontSize: '0.9rem' }}>
                  Contact Support (pujarimanasi12345@gmail.com)
                </a>
              </div>
            </div>
          </section>
        )}
      </main>

      <nav className="bottom-navigation" aria-label="Bottom navigation">
        <button
          className={`bottom-navigation-item ${activeTab === 'home' ? 'active' : ''}`}
          type="button"
          onClick={() => setActiveTab('home')}
          aria-label="Home"
        >
          <Home size={20} />
          <span className="nav-label">Home</span>
        </button>
        <button
          className={`bottom-navigation-item ${activeTab === 'shelf' ? 'active' : ''}`}
          type="button"
          onClick={() => setActiveTab('shelf')}
          aria-label="Shelf"
        >
          <Library size={20} />
          <span className="nav-label">Shelf</span>
        </button>
        <button
          className="bottom-navigation-item camera-nav-btn"
          type="button"
          onClick={openScanner}
          aria-label="Open camera scanner"
        >
          <Camera size={22} />
          <span className="nav-label">Scan</span>
        </button>
        <button
          className={`bottom-navigation-item ${activeTab === 'notifications' ? 'active' : ''}`}
          type="button"
          onClick={() => setActiveTab('notifications')}
          aria-label="Notifications"
        >
          <div className="relative-container">
            <Bell size={20} />
            {notificationProducts.length > 0 && (
              <span className="navbar-badge">{notificationProducts.length}</span>
            )}
          </div>
          <span className="nav-label">Alerts</span>
        </button>
        <button
          className={`bottom-navigation-item ${activeTab === 'help' ? 'active' : ''}`}
          type="button"
          onClick={() => setActiveTab('help')}
          aria-label="Help Center"
        >
          <HelpCircle size={20} />
          <span className="nav-label">Help</span>
        </button>
      </nav>

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
