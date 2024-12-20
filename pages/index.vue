<!-- RandomView.vue -->
<!-- 
  隨機餐廳選擇器組件
  功能：
  1. 獲取用戶當前位置
  2. 在指定範圍內搜索餐廳
  3. 根據評分和關鍵字篩選餐廳
  4. 隨機選擇指定數量的餐廳
  5. 在地圖上顯示結果
-->

<script setup lang="ts">
import { ref, onMounted } from 'vue'

// ===== 常量和狀態定義 =====

// Google Maps API Key
const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

// 地圖相關引用
const mapRef = ref(null) // 地圖容器的 DOM 引用
const map = ref(null) // Google Maps 實例
const service = ref(null) // Places 服務實例
const markers = ref([]) // 地圖標記數組
const currentLocationMarker = ref(null) // 當前位置標記

// 位置相關狀態
const currentPosition = ref(null) // 當前位置坐標
const isLocationReady = ref(false) // 位置是否已準備好
const defaultPosition = {
  // 預設位置（高雄市鳳山區）
  lat: 22.6247,
  lng: 120.3578,
}

// 搜尋相關狀態
const numberOfRestaurants = ref(3) // 要選擇的餐廳數量
const searchRadius = ref(1500) // 搜尋半徑（公尺）
const searchKeyword = ref('') // 搜尋關鍵字
const selectedRestaurants = ref([]) // 已選擇的餐廳列表
const searchRequests = [{ type: 'restaurant' }] // 基本搜尋請求

// ===== 搜尋相關函數 =====

/**
 * 根據關鍵字生成搜尋請求
 * @param keyword 搜尋關鍵字
 * @returns 搜尋請求數組
 */
const getSearchRequests = (keyword: string) => {
  const requests = []

  if (keyword.trim()) {
    // 特殊處理火鍋關鍵字
    if (keyword.includes('火鍋')) {
      requests.push({
        keyword: '火鍋 餐廳',
        type: 'restaurant',
        rankby: 'rating',
      })
    } else {
      // 一般關鍵字處理
      requests.push({
        keyword: keyword.trim() + ' 餐廳',
        type: 'restaurant',
        rankby: 'rating',
      })
    }
  } else {
    // 無關鍵字時搜索所有餐廳
    requests.push({ type: 'restaurant' })
  }

  return requests
}

/**
 * 檢查餐廳是否符合搜尋條件
 * @param place 餐廳資訊
 * @param keyword 搜尋關鍵字
 * @returns 是否符合條件
 */
const isRelevantRestaurant = (place, keyword) => {
  // 檢查營業狀態
  if (place.business_status !== 'OPERATIONAL') {
    return false
  }

  // 無關鍵字時接受所有營業中的餐廳
  if (!keyword) {
    return true
  }

  const lowerKeyword = keyword.toLowerCase()

  // 依序檢查名稱、類型和地址
  return (
    place.name?.toLowerCase().includes(lowerKeyword) ||
    place.types?.some((type) => type.toLowerCase().includes(lowerKeyword)) ||
    place.vicinity?.toLowerCase().includes(lowerKeyword)
  )
}

// ===== 地圖相關函數 =====

/**
 * 等待 Google Maps API 載入
 * @returns Google Maps 實例
 */
const waitForGoogleMaps = () => {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve(window.google.maps)
      return
    }

    // 檢查是否已經有 script 標籤
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]')
    if (existingScript) {
      const checkGoogleMaps = () => {
        if (window.google && window.google.maps) {
          resolve(window.google.maps)
        } else {
          setTimeout(checkGoogleMaps, 100)
        }
      }
      checkGoogleMaps()
      return
    }

    // 如果沒有，創建新的 script 標籤
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`
    script.async = true
    script.defer = true

    script.onload = () => {
      if (window.google && window.google.maps) {
        resolve(window.google.maps)
      } else {
        reject(new Error('Google Maps API failed to load'))
      }
    }

    script.onerror = () => {
      reject(new Error('Failed to load Google Maps API'))
    }

    document.head.appendChild(script)
  })
}

/**
 * 獲取用戶位置
 * @returns 用戶位置坐標
 */
const getUserLocation = () => {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.log('Geolocation is not supported')
      currentPosition.value = defaultPosition
      isLocationReady.value = true
      updateCurrentLocationMarker()
      resolve()
      return
    }

    const locationTimeout = setTimeout(() => {
      console.log('Location request timed out, using default position')
      currentPosition.value = defaultPosition
      isLocationReady.value = true
      updateCurrentLocationMarker()
      resolve()
    }, 10000) // 10 秒超時

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(locationTimeout)
        currentPosition.value = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }
        console.log('Got location:', currentPosition.value)
        isLocationReady.value = true
        updateCurrentLocationMarker()
        resolve()
      },
      (error) => {
        clearTimeout(locationTimeout)
        console.error('Error getting location:', error)
        switch (error.code) {
          case error.PERMISSION_DENIED:
            console.log('User denied the request for Geolocation')
            break
          case error.POSITION_UNAVAILABLE:
            console.log('Location information is unavailable')
            break
          case error.TIMEOUT:
            console.log('The request to get user location timed out')
            break
          default:
            console.log('An unknown error occurred')
        }
        currentPosition.value = defaultPosition
        isLocationReady.value = true
        updateCurrentLocationMarker()
        resolve()
      },
      {
        enableHighAccuracy: true,
        timeout: 10000, // 10 秒
        maximumAge: 30000, // 30 秒的緩存
      },
    )
  })
}

/**
 * 初始化地圖
 */
const initMap = async () => {
  try {
    await waitForGoogleMaps()

    // 確保 mapRef 已經掛載
    if (!mapRef.value) {
      throw new Error('Map container not found')
    }

    // 初始化地圖（使用預設位置）
    map.value = new window.google.maps.Map(mapRef.value, {
      center: defaultPosition,
      zoom: 15,
    })

    service.value = new window.google.maps.places.PlacesService(map.value)

    // 獲取用戶位置
    await getUserLocation()
  } catch (error) {
    console.error('Error initializing map:', error)
  }
}

// ===== 餐廳相關函數 =====

/**
 * 獲取地點詳細信息
 * @param placeId 地點 ID
 * @returns 地點詳細信息
 */
const getPlaceDetails = (placeId) => {
  return new Promise((resolve) => {
    const request = {
      placeId: placeId,
      fields: [
        'opening_hours',
        'formatted_phone_number',
        'url',
        'website',
        'editorial_summary',
        'reviews',
        'user_ratings_total',
        'international_phone_number',
        'types',
        'wheelchair_accessible_entrance',
      ],
    }

    service.value.getDetails(request, (place, status) => {
      if (status === window.google.maps.places.PlacesServiceStatus.OK) {
        resolve(place)
      } else {
        resolve(null)
      }
    })
  })
}

/**
 * 計算兩點之間的距離
 * @param p1 點 1
 * @param p2 點 2
 * @returns 距離（公尺）
 */
const calculateDistance = (p1, p2) => {
  if (!p1 || !p2 || !window.google?.maps?.geometry?.spherical) return null

  // 確保輸入是 LatLng 對象
  const point1 =
    p1 instanceof window.google.maps.LatLng ? p1 : new window.google.maps.LatLng(p1.lat, p1.lng)
  const point2 =
    p2 instanceof window.google.maps.LatLng ? p2 : new window.google.maps.LatLng(p2.lat, p2.lng)

  try {
    return window.google.maps.geometry.spherical.computeDistanceBetween(point1, point2)
  } catch (error) {
    console.error('Error calculating distance:', error)
    return null
  }
}

/**
 * 格式化距離
 * @param meters 距離（公尺）
 * @returns 格式化距離
 */
const formatDistance = (meters) => {
  if (meters === null) return ''
  if (meters < 1000) {
    return `${Math.round(meters)}公尺`
  }
  return `${(meters / 1000).toFixed(1)}公里`
}

/**
 * 格式化營業時間
 * @param openingHours 營業時間
 * @returns 格式化營業時間
 */
const formatOpeningHours = (openingHours) => {
  if (!openingHours) return '無營業時間資訊'

  const isOpen = openingHours.isOpen()
  const status = isOpen ? '營業中' : '休息中'

  // 獲取營業時間表
  const weekdayText = openingHours.weekday_text
  if (!weekdayText) return status

  // 返回狀態和完整營業時間
  return {
    status,
    weekdayText,
  }
}

// ===== 隨機選擇餐廳 =====

/**
 * 隨機選擇餐廳
 */
const getRandomRestaurants = async () => {
  if (!service.value) {
    console.error('Places service not initialized')
    return
  }

  if (!isLocationReady.value) {
    console.log('Waiting for location...')
    return
  }

  try {
    const allResults = []
    const requests = getSearchRequests(searchKeyword.value)

    const searchParams = requests.map((request) => ({
      ...request,
      location: currentPosition.value,
      radius: searchRadius.value,
    }))

    const searchPromises = searchParams.map((request) => {
      return new Promise((resolve) => {
        service.value.nearbySearch(request, (results, status) => {
          if (status === window.google.maps.places.PlacesServiceStatus.OK && results) {
            resolve(results)
          } else {
            console.log('Search status:', status)
            resolve([])
          }
        })
      })
    })

    const results = await Promise.all(searchPromises)
    results.forEach((result) => allResults.push(...result))

    // 去重複並過濾相關結果
    const uniqueResults = Array.from(
      new Map(allResults.map((item) => [item.place_id, item])).values(),
    ).filter((place) => isRelevantRestaurant(place, searchKeyword.value))

    if (uniqueResults.length === 0) {
      console.log('No restaurants found')
      return
    }

    // 根據評分排序並隨機選擇
    const sortedResults = uniqueResults
      .filter((place) => place.rating >= 3.5)
      .sort((a, b) => b.rating - a.rating)

    // 從前 50% 的結果中隨機選擇
    const topHalf = sortedResults.slice(0, Math.ceil(sortedResults.length / 2))
    const shuffled = topHalf.sort(() => 0.5 - Math.random())
    const selected = shuffled.slice(0, numberOfRestaurants.value)

    // 獲取詳細信息
    const detailsPromises = selected.map(async (place) => {
      const details = await getPlaceDetails(place.place_id)
      const distance = calculateDistance(
        currentPosition.value,
        place.geometry?.location?.toJSON() || null,
      )
      return {
        ...place,
        details,
        distance,
      }
    })

    selectedRestaurants.value = await Promise.all(detailsPromises)

    // 更新地圖標記
    updateMapMarkers()

    // 觸發動畫
    if (selectedRestaurants.value.length > 0) {
      triggerConfetti()
    }
  } catch (error) {
    console.error('Error searching for places:', error)
  }
}

// ===== 地圖標記相關函數 =====

/**
 * 更新地圖標記
 */
const updateMapMarkers = () => {
  // 清除舊的標記
  markers.value.forEach((marker) => marker.setMap(null))
  markers.value = []

  // 添加餐廳標記
  selectedRestaurants.value.forEach((restaurant) => {
    // 檢查餐廳是否營業中
    if (restaurant.business_status !== 'OPERATIONAL') {
      return
    }

    const marker = new window.google.maps.Marker({
      position: restaurant.geometry.location,
      map: map.value,
      title: restaurant.name,
      icon: {
        url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
      },
    })

    // 創建資訊視窗
    const infoWindow = new window.google.maps.InfoWindow({
      content: `
        <div style="padding: 10px;">
          <h3 style="margin: 0 0 5px 0;">${restaurant.name}</h3>
          <p style="margin: 0;">${restaurant.vicinity}</p>
          ${restaurant.rating ? `<p style="margin: 5px 0;">評分: ${restaurant.rating} ⭐</p>` : ''}
          ${
            restaurant.business_status === 'OPERATIONAL'
              ? '<p style="margin: 5px 0; color: #4CAF50;">營業中</p>'
              : '<p style="margin: 5px 0; color: #f44336;">已歇業</p>'
          }
        </div>
      `,
    })

    // 點擊標記時顯示資訊視窗
    marker.addListener('click', () => {
      // 關閉其他開啟的資訊視窗
      markers.value.forEach((m) => {
        if (m.infoWindow) {
          m.infoWindow.close()
        }
      })
      infoWindow.open(map.value, marker)
    })

    // 將資訊視窗保存到標記對象中
    marker.infoWindow = infoWindow
    markers.value.push(marker)

    // 預設顯示資訊視窗
    infoWindow.open(map.value, marker)
  })

  // 更新當前位置標記
  updateCurrentLocationMarker()

  // 調整地圖視角以顯示所有標記
  if (selectedRestaurants.value.length > 0) {
    const bounds = new window.google.maps.LatLngBounds()
    selectedRestaurants.value.forEach((place) => {
      if (place.geometry && place.geometry.location) {
        bounds.extend(place.geometry.location)
      }
    })
    // 也加入當前位置
    if (currentPosition.value) {
      bounds.extend(currentPosition.value)
    }
    map.value.fitBounds(bounds)
    // 稍微縮小一點視角
    map.value.setZoom(map.value.getZoom() - 0.5)
  }
}

/**
 * 更新當前位置標記
 */
const updateCurrentLocationMarker = () => {
  if (currentLocationMarker.value) {
    currentLocationMarker.value.setMap(null)
  }

  if (currentPosition.value) {
    currentLocationMarker.value = new window.google.maps.Marker({
      position: currentPosition.value,
      map: map.value,
      title: '目前位置',
      icon: {
        url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
        scaledSize: new window.google.maps.Size(32, 32),
      },
      zIndex: 999, // 確保當前位置標記在最上層
    })

    // 創建當前位置的資訊視窗
    const infoWindow = new window.google.maps.InfoWindow({
      content: `
        <div style="padding: 10px;">
          <h3 style="margin: 0;">目前位置</h3>
          ${
            currentPosition.value === defaultPosition
              ? '<p style="margin: 5px 0; color: #666;">使用預設位置（無法取得實際位置）</p>'
              : '<p style="margin: 5px 0; color: #4CAF50;">已取得實際位置</p>'
          }
        </div>
      `,
    })

    // 點擊標記時顯示資訊視窗
    currentLocationMarker.value.addListener('click', () => {
      infoWindow.open(map.value, currentLocationMarker.value)
    })

    // 預設顯示資訊視窗
    infoWindow.open(map.value, currentLocationMarker.value)

    // 將地圖中心設置為當前位置
    map.value.setCenter(currentPosition.value)
  }
}

// ===== 照片相關函數 =====

/**
 * 獲取餐廳照片 URL
 * @param photoReference 照片參考
 * @returns 照片 URL
 */
const getPhotoUrl = (photoReference) => {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photoReference}&key=${apiKey}`
}

onMounted(() => {
  // 等待 DOM 完全渲染後再初始化地圖
  setTimeout(initMap, 0)
})

// ===== 驗證欄位的值 =====

// 檢查並調整餐廳數量
const checkNumberOfRestaurants = () => {
  const value = Number(numberOfRestaurants.value)
  if (value < 1) {
    numberOfRestaurants.value = 1
  } else if (value > 10) {
    numberOfRestaurants.value = 10
  }
}

// 檢查並調整搜尋半徑
const checkSearchRadius = () => {
  const value = Number(searchRadius.value)
  if (value < 500) {
    searchRadius.value = 500
  } else if (value > 5000) {
    searchRadius.value = 5000
  }
}

// ===== 彩票動畫 =====

const showConfetti = ref(false)

const triggerConfetti = () => {
  showConfetti.value = true
  setTimeout(() => {
    showConfetti.value = false
  }, 7000)
}
</script>

<template>
  <!-- 主容器：整個應用的根容器，使用 flex 佈局垂直排列各個部分 -->
  <div class="random-container">
    <h1 style="text-align: center; font-weight: 600; font-size: 28px">欸要吃什麼 - 隨機抽抽</h1>
    <!-- 控制面板：包含所有用戶輸入控件，用於設置搜尋參數 -->
    <div class="control-panel">
      <!-- 餐廳數量選擇：允許用戶選擇要隨機抽選的餐廳數量（1-5間） -->
      <div class="input-group">
        <label>要抽選幾間餐廳？ (1-10 間)</label>
        <input
          type="number"
          v-model="numberOfRestaurants"
          min="1"
          max="10"
          title="選擇要隨機抽選的餐廳數量，範圍為 1-10 間"
          @blur="checkNumberOfRestaurants"
        />
      </div>

      <!-- 搜尋半徑設置：設定搜尋範圍（500-5000公尺） -->
      <div class="input-group">
        <label>搜尋半徑 (公尺) ? (500-5000 公尺)</label>
        <input
          type="number"
          v-model="searchRadius"
          min="500"
          max="5000"
          step="100"
          title="設定搜尋範圍，最小 500 公尺，最大 5000 公尺"
          @blur="checkSearchRadius"
        />
      </div>

      <!-- 關鍵字搜尋：允許輸入特定餐廳類型或名稱 -->
      <div class="input-group">
        <label>搜尋關鍵字</label>
        <input
          type="text"
          v-model="searchKeyword"
          placeholder="輸入餐廳類型、名稱等"
          class="keyword-input"
          title="可輸入餐廳類型（如：火鍋）或特定餐廳名稱"
        />
      </div>

      <!-- 搜尋按鈕：觸發隨機抽選功能，在定位完成前保持禁用狀態 -->
      <button
        @click="getRandomRestaurants"
        :disabled="!isLocationReady"
        class="search-button"
        :title="isLocationReady ? '點擊開始隨機抽選餐廳' : '正在獲取位置資訊'"
      >
        {{ isLocationReady ? '開始抽選' : '定位中...' }}
      </button>
    </div>

    <!-- 搜尋結果區域：只在有搜尋結果時顯示 -->
    <div v-if="selectedRestaurants.length > 0" class="results">
      <h2>抽選結果</h2>
      <!-- 餐廳卡片網格：使用 CSS Grid 自適應排列餐廳卡片 -->
      <div class="restaurant-cards">
        <!-- 餐廳卡片：迭代顯示每個選中的餐廳資訊 -->
        <div
          v-for="restaurant in selectedRestaurants"
          :key="restaurant.place_id"
          class="restaurant-card"
        >
          <!-- 餐廳照片：如果有照片則顯示，否則隱藏 -->
          <img
            v-if="restaurant.photos?.[0]?.photo_reference"
            :src="getPhotoUrl(restaurant.photos[0].photo_reference)"
            :alt="restaurant.name"
            class="restaurant-photo"
            @error="$event.target.style.display = 'none'"
            title="餐廳照片"
          />

          <!-- 餐廳詳細資訊區域 -->
          <div class="restaurant-info">
            <!-- 餐廳名稱 -->
            <h3>{{ restaurant.name }}</h3>

            <!-- 評分資訊 -->
            <p class="rating" title="餐廳評分">
              評分: {{ restaurant.rating }}
              <span class="star">⭐</span>
              <span class="total-ratings" v-if="restaurant.details?.user_ratings_total">
                ({{ restaurant.details.user_ratings_total }} 則評價)
              </span>
            </p>

            <!-- 餐廳類型 -->
            <p class="types" v-if="restaurant.types?.length" title="餐廳類型">
              類型: {{ restaurant.types.map((type) => type.replace(/_/g, ' ')).join(', ') }}
            </p>

            <!-- 簡介 -->
            <p
              class="description"
              v-if="restaurant.details?.editorial_summary?.overview"
              title="餐廳簡介"
            >
              簡介: {{ restaurant.details.editorial_summary.overview }}
            </p>

            <!-- 地址資訊 -->
            <p class="address" title="餐廳地址">地址: {{ restaurant.vicinity }}</p>

            <!-- 電話資訊 -->
            <p class="phone" v-if="restaurant.details?.formatted_phone_number" title="餐廳電話">
              電話: {{ restaurant.details.formatted_phone_number }}
            </p>

            <!-- 距離資訊：只在有距離數據時顯示 -->
            <p class="distance" v-if="restaurant.distance !== null" title="與當前位置的距離">
              距離: {{ formatDistance(restaurant.distance) }}
            </p>

            <!-- 營業時間：顯示目前狀態和完整營業時間表 -->
            <div
              class="opening-hours"
              v-if="restaurant.details && restaurant.details.opening_hours"
              title="營業時間資訊"
            >
              <!-- <p
                :class="{
                  open: formatOpeningHours(restaurant.details.opening_hours).status === '營業中',
                }"
              >
                {{ formatOpeningHours(restaurant.details.opening_hours).status }}
              </p> -->
              <div class="weekday-hours">
                <p
                  v-for="(hours, index) in formatOpeningHours(restaurant.details.opening_hours)
                    .weekdayText"
                  :key="index"
                  class="weekday-text"
                >
                  {{ hours }}
                </p>
              </div>
            </div>

            <!-- 價位資訊 -->
            <p class="price-level" title="價位範圍">
              價位: {{ '💰'.repeat(restaurant.price_level || 1) }}
            </p>

            <!-- 無障礙設施 -->
            <p
              class="accessibility"
              v-if="restaurant.details?.wheelchair_accessible_entrance !== undefined"
              title="無障礙設施"
            >
              無障礙設施: {{ restaurant.details.wheelchair_accessible_entrance ? '有' : '無' }}
            </p>

            <!-- 網站連結 -->
            <a
              v-if="restaurant.details?.website"
              :href="restaurant.details.website"
              target="_blank"
              class="view-website"
              title="訪問餐廳官網"
            >
              訪問官網
            </a>

            <!-- Google Maps 連結：在新分頁中打開餐廳的 Google Maps 頁面 -->
            <a
              :href="'https://www.google.com/maps/place/?q=place_id:' + restaurant.place_id"
              target="_blank"
              class="view-map"
              title="在 Google Maps 中查看詳細資訊"
            >
              在 Google Maps 中查看
            </a>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="">
      <p>請點擊開始抽選，或是換個條件再試一次</p>
    </div>

    <!-- 地圖容器移到這裡，使用 style 綁定控制顯示/隱藏 -->
    <div
      id="map"
      ref="mapRef"
      :style="{ display: selectedRestaurants.length > 0 ? 'block' : 'none' }"
    ></div>

    <!-- 彩票 -->
    <div v-if="showConfetti" class="confetti-container">
      <div
        v-for="n in 100"
        :key="n"
        class="confetti"
        :style="{
          '--delay': `${Math.random() * 2}s`,
          '--duration': `${2 + Math.random() * 2}s`,
          '--x-start': `${Math.random() * 100}%`,
          '--x-end': `${-30 + Math.random() * 60}vw`,
          '--rotation': `${Math.random() * 720 - 360}deg`,
          'background-color': `hsl(${Math.random() * 360}deg, 85%, ${75 + Math.random() * 15}%)`,
          width: `${6 + Math.random() * 6}px`,
          height: `${10 + Math.random() * 6}px`,
          opacity: `${0.8 + Math.random() * 0.2}`,
          left: 'var(--x-start)',
        }"
      >
        <div class="ticket-pattern"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 主容器樣式 */
.random-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: 20px 0;
  gap: 20px;
  width: 100%;
}
/* 控制面板樣式 */
.control-panel {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  align-items: start;
  gap: 12px;
  align-content: start;
  flex-wrap: wrap;
}

/* 輸入組樣式 */
.input-group {
  display: flex;
  align-items: start;
  flex-direction: column;

  gap: 4px;
  width: 100%;
}

/* 輸入框基本樣式 */
.input-group input {
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  width: 98%;
}

/* 數字輸入框寬度 */
.input-group input[type='number'] {
  /* width: 100px; */
}

/* 關鍵字輸入框寬度 */
.keyword-input {
  /* width: 200px; */
}

/* 按鈕樣式 */
button {
  padding: 10px 20px;
  background-color: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
}

/* 禁用按鈕樣式 */
button:disabled {
  background-color: #cccccc;
  cursor: not-allowed;
}

/* 結果區域樣式 */
.results {
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 餐廳卡片網格佈局 */
.restaurant-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

/* 單個餐廳卡片樣式 */
.restaurant-card {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

/* 餐廳照片樣式 */
.restaurant-photo {
  width: 100%;
  height: 200px;
  object-fit: cover;
}

/* 餐廳資訊區域樣式 */
.restaurant-info {
  padding: 15px;
  width: 100%;
}

/* 餐廳名稱樣式 */
.restaurant-info h3 {
  margin: 0 0 10px 0;
  color: #333;
}

/* 餐廳資訊文字樣式 */
.restaurant-info p {
  margin: 5px 0;
  color: #666;
}

/* 距離文字樣式 */
.distance {
  color: #2196f3;
  font-weight: bold;
}

/* 營業時間文字樣式 */
.opening-hours {
  color: #4caf50;
  font-weight: bold;
}

/* 價位文字樣式 */
.price-level {
  color: #ffc107;
}

/* 營業時間樣式 */
.opening-hours {
  margin: 10px 0;
  padding: 10px;
  border-radius: 4px;
  background-color: #f5f5f5;
}

.opening-hours p {
  margin: 0;
  font-weight: bold;
}

.opening-hours .open {
  color: #4caf50;
}

.weekday-hours {
  margin-top: 8px;
  font-size: 0.9em;
}

.weekday-text {
  margin: 2px 0;
  color: #666;
}

/* 訪問官網 */
.view-website {
  display: inline-block;
  margin-top: 10px;
  padding: 8px 12px;
  background-color: #3dbd77;
  color: white;
  text-decoration: none;
  border-radius: 4px;
  font-size: 14px;
  margin-right: 8px;
}

/* 地圖連結按鈕樣式 */
.view-map {
  display: inline-block;
  margin-top: 10px;
  padding: 8px 12px;
  background-color: #1a73e8;
  color: white;
  text-decoration: none;
  border-radius: 4px;
  font-size: 14px;
}

/* 地圖容器樣式 */
#map {
  width: 100%;
  height: 500px;
  min-height: 500px;
  border-radius: 8px;
  overflow: hidden;
  margin-top: 20px; /* 添加上邊距 */
}

/* 修改動畫相關的樣式 */
.confetti-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100vh;
  pointer-events: none;
  z-index: 9999;
}

.confetti {
  position: absolute;
  border-radius: 1px;
  top: -20px;
  animation: fall var(--duration) ease-in forwards;
  animation-delay: var(--delay);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

@keyframes fall {
  from {
    transform: translateY(0) translateX(0) rotate(0);
    opacity: var(--opacity);
  }
  to {
    transform: translateY(105vh) translateX(var(--x-end)) rotate(var(--rotation));
    opacity: 0;
  }
}

.ticket-pattern {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.4) 25%,
    transparent 25%,
    transparent 50%,
    rgba(255, 255, 255, 0.4) 50%,
    rgba(255, 255, 255, 0.4) 75%,
    transparent 75%,
    transparent
  );
  background-size: 2px 2px;
  opacity: 0.8;
}
/* 響應式設計 */
@media (max-width: 1200px) {
  /* 控制面板在小螢幕上垂直排列 */
  /* .control-panel {
    flex-direction: column;
    align-items: stretch;
  } */

  /* 輸入組在小螢幕上垂直排列 */
  /* .input-group {
    flex-direction: column;
    align-items: stretch;
  } */

  /* 輸入框在小螢幕上佔滿寬度 */
  /* .input-group input {
    width: 100%;
  } */

  /* #map {
    height: 400px;
    min-height: 400px;
  } */
}
</style>
