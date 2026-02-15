// -----------------------------
// ZAKŁADAM: Cesium jest już załadowany i masz elementy DOM:
// - div#cesiumContainer
// - div#uiLabel z elementami #labelHeader, #labelList, #labelText, #closeBtn
// - obrazki "star.png" i "arrow.png" dostępne
// -----------------------------

const Z_INDEX = {
    ARROW_NORMAL: 10,
    BOX: 20,
    ARROW_ACTIVE: 30
};

// Utwórz clamp (było undefined — teraz jest)
function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
}

function loadMarathonsFromURL(url, callback) {
    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error("Nie udało się wczytać pliku");
            return response.text();
        })
        .then(text => {
            const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
            const marathonMap = new Map();

            lines.forEach(line => {
                const parts = line.split("|").map(p => p.trim());
                if (parts.length < 7) return;

                const [id, country, city, lonStr, latStr, type, date] = parts;
                const lon = parseFloat(lonStr);
                const lat = parseFloat(latStr);

                if (!marathonMap.has(id)) {
                    marathonMap.set(id, {
                        id: id,
                        country: country,
                        city: city,
                        lon: lon,
                        lat: lat,
                        marathons: []
                    });
                }

                marathonMap.get(id).marathons.push({ type: type, date: date });
            });

            const marathonPointsGrouped = Array.from(marathonMap.values());
            callback(marathonPointsGrouped);
        })
        .catch(err => console.error("Błąd wczytywania maratonów:", err));
}

// Detect mobile devices for further optimizations
const isMobile = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|webOS/i.test(navigator.userAgent);
const isSmallScreen = window.innerWidth < 1024;
const isVerySmallScreen = window.innerWidth < 480;
const screenWidth = window.innerWidth;

const viewer = new Cesium.Viewer('cesiumContainer', {
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    imageryProvider: new Cesium.OpenStreetMapImageryProvider({
        url: "https://a.tile.openstreetmap.org/"
    }),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    timeline: false,
    navigationHelpButton: false,
    animation: false,
    creditsDisplay: false,
    selectionIndicator: false,
    infoBox: false,
});

// Performance adjustments
if (isMobile || isSmallScreen) {
    viewer.resolutionScale = 1.0;
    viewer.scene.globe.maximumScreenSpaceError = 8;
    if (viewer.scene.postProcessStages && viewer.scene.postProcessStages.fxaa) {
        viewer.scene.postProcessStages.fxaa.enabled = false;
    }
}
if (isVerySmallScreen) {
    viewer.resolutionScale = 0.8;
    viewer.scene.globe.maximumScreenSpaceError = 16;
}

const handler = viewer.cesiumWidget.screenSpaceEventHandler;
handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
handler.removeInputAction(Cesium.ScreenSpaceEventType.PINCH_MOVE);
handler.removeInputAction(Cesium.ScreenSpaceEventType.PINCH_END);
viewer.scene.screenSpaceCameraController.enableTilt = false;

let previousPinchDistance = null;
handler.setInputAction(function (twoPoints) {
    const dx = twoPoints.position2.x - twoPoints.position1.x;
    const dy = twoPoints.position2.y - twoPoints.position1.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (previousPinchDistance !== null) {
        const delta = distance - previousPinchDistance;
        viewer.camera.moveForward(-delta * 0.5);
    }

    previousPinchDistance = distance;
}, Cesium.ScreenSpaceEventHandler.TwoPointMotionEvent);
handler.setInputAction(function () {
    previousPinchDistance = null;
}, Cesium.ScreenSpaceEventHandler.TwoPointEndEvent);

viewer.imageryLayers.addImageryProvider(
    new Cesium.OpenStreetMapImageryProvider({
        url: 'https://a.tile.openstreetmap.org/',
        minimumLevel: 0,
        maximumLevel: 10
    })
);

const scene = viewer.scene;
// 1) Kolor tła sceny (za globusem)
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#071230'); // głębokie granatowe tło

    // 2) Atmosfera nieba - nadajemy nasycenie i przesunięcie barwy
    scene.skyAtmosphere.show = true;
    // hueShift: -1..1 (przesuwa barwę), saturationShift: -1..1, brightnessShift: -1..1
    scene.skyAtmosphere.hueShift = -0.6;       // lekko w stronę fioletu/indigo
    scene.skyAtmosphere.saturationShift = 0.45; // bardziej nasycone
    scene.skyAtmosphere.brightnessShift = -0.02;

    // 3) Włącz oświetlenie globusa (ładniejsze cieniowanie)
    scene.globe.enableLighting = true;
    // bazowy kolor globusa używany tam, gdzie brak kafli / jako subtelny tint
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#0b1a2b');

    // 4) Usuń istniejące warstwy (opcjonalnie) i dodaj warstwy kolorystyczne:
    try { viewer.imageryLayers.removeAll(); } catch (e) { /* safe */ }

    // Warstwa 1: kolorowy efekt "malarski" (Stamen Watercolor)
    // źródło: https://stamen.com (public tiles) - bez klucza
    const watercolor = viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
            url: 'https://stamen-tiles.a.ssl.fastly.net/watercolor/{z}/{x}/{y}.jpg',
            maximumLevel: 18,
            credit: 'Map tiles by Stamen'
        })
    );
    watercolor.alpha = 1.0; // pełna widoczność

    // Warstwa 2: lekko przeźroczyste OSM dla etykiet i rysunku linii
    const osmLabels = viewer.imageryLayers.addImageryProvider(
        new Cesium.OpenStreetMapImageryProvider({
            url: 'https://a.tile.openstreetmap.org/'
        })
    );
    osmLabels.alpha = 0.55; // pół-przezroczyste, żeby nie przysłonić akwareli

    // Warstwa 3: delikatne podbicie kontrastu (możesz wyłączyć)
    // Tu można dodać np. hillshade albo custom overlay — zostawiłem komentarz.

    // 5) Włącz słońce (dynamiczne oświetlenie) i lekko podbij cień
    scene.sun.show = true;
    scene.moon.show = false; // możesz włączyć jeśli chcesz efektu księżyca
    scene.globe.dynamicAtmosphereLighting = true;

    // 6) Drobne wizualne ułatwienie - delikatne cienie billboardów (opcjonalne)
    // (uwaga: billboardy domyślnie nie rzucają cienia na globe, to tylko kosmetyka)

    // 7) Funkcja do szybkiego przełączania presetów kolorystycznych
    window.setColorStyle = function (preset) {
        // presets: 'watercolor', 'vivid', 'dark'
        if (preset === 'vivid') {
            viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#081028');
            scene.skyAtmosphere.hueShift = -0.3;
            scene.skyAtmosphere.saturationShift = 0.7;
            scene.globe.baseColor = Cesium.Color.fromCssColorString('#072a3a');
            watercolor.alpha = 0.95;
            osmLabels.alpha = 0.65;
        } else if (preset === 'dark') {
            viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#000814');
            scene.skyAtmosphere.hueShift = -0.9;
            scene.skyAtmosphere.saturationShift = 0.05;
            scene.globe.baseColor = Cesium.Color.fromCssColorString('#001018');
            watercolor.alpha = 0.65;
            osmLabels.alpha = 0.45;
        } else { // 'watercolor' (domyślny)
            viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#071230');
            scene.skyAtmosphere.hueShift = -0.6;
            scene.skyAtmosphere.saturationShift = 0.45;
            scene.globe.baseColor = Cesium.Color.fromCssColorString('#0b1a2b');
            watercolor.alpha = 1.0;
            osmLabels.alpha = 0.55;
        }
    };

    // ustaw domyślny preset
    setColorStyle('watercolor');
/*scene.skyBox.show = false;
scene.skyAtmosphere.show = false;
scene.sun.show = false;
scene.moon.show = false;*/

const ellipsoid = Cesium.Ellipsoid.WGS84;
const occluder = new Cesium.EllipsoidalOccluder(ellipsoid, viewer.camera.positionWC);

// Helper: convert a world Cartesian to canvas coordinates relative to the Cesium container
function worldToContainerCoords(cartesian) {
    // scene.cartesianToCanvasCoordinates returns coordinates relative to scene.canvas client area
    const canvasPos = scene.cartesianToCanvasCoordinates(cartesian);
    if (!canvasPos) return null;

    // Get canvas bounding rect relative to container—because arrowDivs are appended to viewer.container
    const containerRect = viewer.container.getBoundingClientRect();
    const canvasRect = scene.canvas.getBoundingClientRect();
    const offsetLeft = canvasRect.left - containerRect.left;
    const offsetTop = canvasRect.top - containerRect.top;

    return {
        x: canvasPos.x + offsetLeft,
        y: canvasPos.y + offsetTop,
        canvasX: canvasPos.x, // relative to canvas (useful for center calculations)
        canvasY: canvasPos.y
    };
}

// Bearing and edge helpers (used if point is behind globe or offscreen)
function getBearingFromCameraToPoint(cartesian) {
    const direction = Cesium.Cartesian3.subtract(cartesian, viewer.camera.positionWC, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(direction, direction);
    const cameraDirection = new Cesium.Cartesian3();
    Cesium.Matrix4.multiplyByPointAsVector(viewer.camera.viewMatrix, direction, cameraDirection);
    return Math.atan2(cameraDirection.y, cameraDirection.x);
}

function getScreenEdgePosition(bearing, canvasSize) {
    const centerX = canvasSize.width / 2;
    const centerY = canvasSize.height / 2;
    const dx = Math.cos(bearing);
    const dy = Math.sin(bearing);
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (canvasSize.width - centerX) / dx);
    if (dx < 0) t = Math.min(t, (0 - centerX) / dx);
    if (dy > 0) t = Math.min(t, (canvasSize.height - centerY) / dy);
    if (dy < 0) t = Math.min(t, (0 - centerY) / dy);
    const screenX = centerX + t * dx;
    const screenY = centerY + t * dy;
    return { x: screenX, y: screenY };
}

// Compute horizon radius (in pixels) for current camera — used to place arrows exactly on horizon
function computeHorizonRadiusPx(canvasHeight, camera) {
    const R = ellipsoid.maximumRadius;
    const d = Cesium.Cartesian3.magnitude(camera.positionWC);
    const ratio = Math.max(0.000001, Math.min(1 - 1e-8, R / d));
    const theta = Math.asin(ratio); // angle between camera->center and tangent
    const fovy = camera.frustum.fovy || Cesium.Math.toRadians(60);
    const pixelPerRad = canvasHeight / fovy;
    return theta * pixelPerRad;
}

// Initial view
viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(55.2708, 25.2048, isSmallScreen ? 4000000 : 9000000) });
scene.screenSpaceCameraController.minimumZoomDistance = 5000000;
scene.screenSpaceCameraController.maximumZoomDistance = 8571000*1.3;

const label = document.getElementById('uiLabel');
document.getElementById('cesiumContainer').appendChild(label);
label.style.position = 'absolute';
label.style.zIndex = Z_INDEX.BOX;
const labelText = document.getElementById('labelText');
const closeBtn = document.getElementById('closeBtn');
let activeEntity = null;

// IMPORTANT CSS: ensure #cesiumContainer has position:relative and overflow:hidden
// e.g. in your CSS:
// #cesiumContainer { position: relative; overflow: hidden; }

// Load marathons and create points/arrows
loadMarathonsFromURL("marathons.txt", function (marathonPoints) {
    // arrow size base (will be adjusted in adjustForDevice)
    let arrowSizeNum = isSmallScreen ? Math.max(32, Math.round(screenWidth / 6)) : 40;

    const points = marathonPoints.map(p => {
        const entity = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 1),
            billboard: {
                image: "star.png",
                width: 40,
                height: 40,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM
            }
        });
        entity.data = p;
        entity.clickState = 0;

        // Create arrow div appended to viewer.container (absolute positioning)
        entity.arrowDiv = document.createElement('div');
        entity.arrowDiv.className = 'arrowIndicator';
        entity.arrowDiv.style.position = 'absolute';
        entity.arrowDiv.style.zIndex = Z_INDEX.ARROW_NORMAL;
        entity.arrowDiv.style.opacity = '1';
        entity.arrowDiv.style.width = arrowSizeNum + 'px';
        entity.arrowDiv.style.height = arrowSizeNum + 'px';
        entity.arrowDiv.style.padding = '6px';
        entity.arrowDiv.style.pointerEvents = 'auto';
        entity.arrowDiv.style.display = 'none';
        entity.arrowDiv.style.transformOrigin = '50% 50%';
        entity.arrowDiv.style.userSelect = 'none';
        entity.arrowDiv.innerHTML = '<img src="arrow.png" style="width:100%; height:100%; object-fit:contain; display:block;">';
        // store reference to entity
        entity.arrowDiv.entity = entity;

        // Click arrow: set activeEntity and flyTo - don't auto-hide label
        entity.arrowDiv.addEventListener('click', function (evt) {
            evt.stopPropagation();
            const ent = this.entity;
            // set active to this entity so overlay will attach to arrow if star not visible
            activeEntity = ent;
            updateArrowPriority(activeEntity);
            // also fly to the star (but don't hide overlay)
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(ent.data.lon, ent.data.lat, scene.screenSpaceCameraController.minimumZoomDistance),
                duration: 1.2
            });
        });

        // Append to viewer container (not document.body)
        viewer.container.appendChild(entity.arrowDiv);

        return entity;
    });

    function updateArrowPriority(activeEntity) {
        points.forEach(p => {
            if (p === activeEntity) {
                p.arrowDiv.style.zIndex = Z_INDEX.ARROW_ACTIVE;
                p.arrowDiv.style.opacity = '0.45';   // 👈 pół-przezroczysta
                p.arrowDiv.style.pointerEvents = 'auto';
            } else {
                p.arrowDiv.style.zIndex = Z_INDEX.ARROW_NORMAL;
                p.arrowDiv.style.opacity = '1';
                p.arrowDiv.style.pointerEvents = 'auto';
            }
        });
    }

    function hideOverlay() {
        activeEntity = null;
        label.style.display = 'none';
        updateArrowPriority(null);
    }
    closeBtn.addEventListener('click', hideOverlay);

    // Click on globe/star
    const clickHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    clickHandler.setInputAction(function (click) {
        const picked = scene.pick(click.position);
        if (Cesium.defined(picked) && picked.id) {
            const entity = picked.id;
            // Toggle or set active
            if (entity.clickState === 0) {
                entity.clickState = 1;
                activeEntity = entity;
                updateArrowPriority(activeEntity);
                points.forEach(p => { if (p !== entity) p.clickState = 0; });
            } else {
                viewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(
                        entity.data.lon,
                        entity.data.lat,
                        scene.screenSpaceCameraController.minimumZoomDistance
                    ),
                    duration: 1.2
                });
                entity.clickState = 0;
                activeEntity = entity;
                updateArrowPriority(activeEntity);
            }
        } else {
            hideOverlay();
            points.forEach(p => p.clickState = 0);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Pre-render loop: update visibility, arrow positions, and label positioning
    scene.preRender.addEventListener(() => {
        // compute canvas and container sizes/offsets
        const containerRect = viewer.container.getBoundingClientRect();
        const canvasRect = scene.canvas.getBoundingClientRect();
        const canvasWidth = canvasRect.width;
        const canvasHeight = canvasRect.height;
        const canvasOffsetLeft = canvasRect.left - containerRect.left;
        const canvasOffsetTop = canvasRect.top - containerRect.top;

        // update occluder camera position
        occluder.cameraPosition = viewer.camera.positionWC;

        // compute geometric horizon radius in pixels for this camera/view
        const horizonR = computeHorizonRadiusPx(canvasHeight, viewer.camera);

        // Update each entity
        points.forEach(entity => {
            const pos = entity.position.getValue(Cesium.JulianDate.now());
            const visible = occluder.isPointVisible(pos);
            entity.billboard.show = visible;

            const canvasCoords = scene.cartesianToCanvasCoordinates(pos);

            const isOccluded = !visible;
            const isOffscreen = !!canvasCoords && (canvasCoords.x < 0 || canvasCoords.x > canvasWidth || canvasCoords.y < 0 || canvasCoords.y > canvasHeight);
            const hasProjection = !!canvasCoords;

            let arrowShouldShow = isOccluded || !hasProjection || isOffscreen;
            if (!arrowShouldShow) {
                entity.arrowDiv.style.display = 'none';
                return;
            }

            const centerX = canvasWidth / 2;
            const centerY = canvasHeight / 2;
            const tipOffset = Math.max(6, Math.round(arrowSizeNum / 2));

            let targetX, targetY, rotAngleDeg;

            if (isOccluded) {
                // --- 1. Compute angle from center to star ---
                let angleRad;
                if (canvasCoords) {
                    const dx = canvasCoords.x - centerX;
                    const dy = canvasCoords.y - centerY;
                    angleRad = Math.atan2(dy, dx);
                } else {
                    const bearing = getBearingFromCameraToPoint(pos);
                    angleRad = bearing + Math.PI; // invert
                }

                // --- 2. Set position exactly on horizon ---
                let finalX = centerX + Math.cos(angleRad) * horizonR;
                let finalY = centerY + Math.sin(angleRad) * horizonR;

                // --- 3. Optionally limit vertical deviation ---
                const dy = finalY - centerY;
                const maxVertical = horizonR * 0.9; // e.g., 90% of radius
                if (dy > maxVertical) finalY = centerY + maxVertical;
                if (dy < -maxVertical) finalY = centerY - maxVertical;

                // --- 4. Arrow rotation toward star beyond horizon ---
                const extra = Math.max(100, Math.round(horizonR * 0.4));
                const rotationTargetX = centerX + Math.cos(angleRad) * (horizonR + extra);
                const rotationTargetY = centerY + Math.sin(angleRad) * (horizonR + extra);
                let rotAngleDeg = Math.atan2(rotationTargetY - finalY, rotationTargetX - finalX) * 180 / Math.PI;

                // --- 5. Smooth LERP ---
                entity.arrowDiv._prevX = entity.arrowDiv._prevX ?? finalX;
                entity.arrowDiv._prevY = entity.arrowDiv._prevY ?? finalY;
                entity.arrowDiv._prevRot = entity.arrowDiv._prevRot ?? rotAngleDeg;

                const lerpFactor = 0.2;
                const lerpX = entity.arrowDiv._prevX + (finalX - entity.arrowDiv._prevX) * lerpFactor;
                const lerpY = entity.arrowDiv._prevY + (finalY - entity.arrowDiv._prevY) * lerpFactor;
                const lerpRot = entity.arrowDiv._prevRot + (rotAngleDeg - entity.arrowDiv._prevRot) * lerpFactor;

                entity.arrowDiv._prevX = lerpX;
                entity.arrowDiv._prevY = lerpY;
                entity.arrowDiv._prevRot = lerpRot;

                // --- 6. Position in container ---
                const margin = Math.max(8, Math.round(arrowSizeNum / 2));
                const leftClamped = clamp(canvasOffsetLeft + lerpX - arrowSizeNum / 2, -margin/40, canvasWidth - margin*2);
                const topClamped = clamp(canvasOffsetTop + lerpY - arrowSizeNum / 2, -margin/40, canvasHeight - margin*2);

                entity.arrowDiv.style.left = leftClamped + 'px';
                entity.arrowDiv.style.top = topClamped + 'px';
                entity.arrowDiv.style.transform = `rotate(${lerpRot}deg)`;
                entity.arrowDiv.style.display = 'block';
            } else if (isOffscreen) {
                const projX = canvasCoords ? canvasCoords.x : centerX;
                const projY = canvasCoords ? canvasCoords.y : centerY;
                const vx = projX - centerX;
                const vy = projY - centerY;
                const ang = Math.atan2(vy, vx);

                const edgePos = getScreenEdgePosition(ang, { width: canvasWidth, height: canvasHeight });
                targetX = clamp(edgePos.x, Math.max(8, Math.round(arrowSizeNum / 2)), canvasWidth - Math.max(8, Math.round(arrowSizeNum / 2)));
                targetY = clamp(edgePos.y, Math.max(8, Math.round(arrowSizeNum / 2)), canvasHeight - Math.max(8, Math.round(arrowSizeNum / 2)));

                const v_arrow_to_proj_x = projX - targetX;
                const v_arrow_to_proj_y = projY - targetY;
                const v_arrow_to_center_x = centerX - targetX;
                const v_arrow_to_center_y = centerY - targetY;
                const dot = v_arrow_to_proj_x * v_arrow_to_center_x + v_arrow_to_proj_y * v_arrow_to_center_y;
                const lenProj = Math.hypot(v_arrow_to_proj_x, v_arrow_to_proj_y);
                const lenCenter = Math.hypot(v_arrow_to_center_x, v_arrow_to_center_y);

                let rotationTargetX, rotationTargetY;
                if (lenProj > 0 && dot > 0 && lenProj < lenCenter * 0.95) {
                    const beyond = 200;
                    rotationTargetX = centerX + Math.cos(ang) * (Math.max(canvasWidth, canvasHeight) + beyond);
                    rotationTargetY = centerY + Math.sin(ang) * (Math.max(canvasWidth, canvasHeight) + beyond);
                } else {
                    rotationTargetX = projX;
                    rotationTargetY = projY;
                }

                rotAngleDeg = Math.atan2(rotationTargetY - targetY, rotationTargetX - targetX) * 180 / Math.PI;
            } else {
                targetX = clamp(canvasCoords.x, Math.max(8, Math.round(arrowSizeNum / 2)), canvasWidth - Math.max(8, Math.round(arrowSizeNum / 2)));
                targetY = clamp(canvasCoords.y, Math.max(8, Math.round(arrowSizeNum / 2)), canvasHeight - Math.max(8, Math.round(arrowSizeNum / 2)));
                rotAngleDeg = 0;
            }

            // Sprawdźmy, czy strzałka wcześniej była widoczna
            const arrowWasVisible = entity.arrowDiv.style.display !== 'none';
            // jeśli to pierwsze pojawienie się strzałki, od razu ustawiamy na docelową
            if (!arrowWasVisible) {
                entity.arrowDiv._currentX = targetX;
                entity.arrowDiv._currentY = targetY;
                entity.arrowDiv._currentRot = rotAngleDeg;
            } else {
                // --- LERP tylko gdy strzałka już była widoczna ---
                const lerpFactor = 0.15;
                entity.arrowDiv._currentX += (targetX - entity.arrowDiv._currentX) * lerpFactor;
                entity.arrowDiv._currentY += (targetY - entity.arrowDiv._currentY) * lerpFactor;

                // interpolacja kąta z wrap-around 360°
                let deltaRot = rotAngleDeg - entity.arrowDiv._currentRot;
                if (deltaRot > 180) deltaRot -= 360;
                if (deltaRot < -180) deltaRot += 360;
                entity.arrowDiv._currentRot += deltaRot * lerpFactor;
            }

            // ustawienie pozycji w container
            const leftInContainer = canvasOffsetLeft + entity.arrowDiv._currentX - arrowSizeNum / 2;
            const topInContainer = canvasOffsetTop + entity.arrowDiv._currentY - arrowSizeNum / 2;
            const containerW = containerRect.width;
            const containerH = containerRect.height;
            const leftClamped = Math.max(0, Math.min(containerW - arrowSizeNum, leftInContainer));
            const topClamped = Math.max(0, Math.min(containerH - arrowSizeNum, topInContainer));

            entity.arrowDiv.style.left = leftClamped + 'px';
            entity.arrowDiv.style.top = topClamped + 'px';
            entity.arrowDiv.style.transform = `rotate(${entity.arrowDiv._currentRot}deg)`;
            entity.arrowDiv.style.display = 'block';
        });

        // Label positioning: if activeEntity exists, attach popup either to star (if visible/on-canvas)
        // or to the arrow (center of arrowDiv)
        if (activeEntity) {
            const pos = activeEntity.position.getValue(Cesium.JulianDate.now());
            const isVisible = occluder.isPointVisible(pos);
            const canvasCoords = scene.cartesianToCanvasCoordinates(pos);

            // Prepare label content
            const labelHeader = document.getElementById('labelHeader');
            labelHeader.innerHTML = `${activeEntity.data.country}: ${activeEntity.data.city}`;

            const labelList = document.getElementById('labelList');
            labelList.innerHTML = "";
            activeEntity.data.marathons.forEach(m => {
                const li = document.createElement("li");
                li.innerHTML = `<b>${m.type}</b>: ${m.date}`;
                labelList.appendChild(li);
            });

            // Determine popup target position (relative to container)
            let popupX, popupY; // container coords
            let popupAnchorIsArrow = false;
            if (isVisible && canvasCoords && canvasCoords.x >= 0 && canvasCoords.x <= canvasRect.width && canvasCoords.y >= 0 && canvasCoords.y <= canvasRect.height) {
                // star visible on canvas -> attach to star
                popupX = canvasCoords.x + (canvasRect.left - containerRect.left);
                popupY = canvasCoords.y + (canvasRect.top - containerRect.top);
            } else {
                // attach to arrow center
                const arrowRect = activeEntity.arrowDiv.getBoundingClientRect();
                // arrowRect is relative to viewport; convert to container coordinates
                const containerRect2 = viewer.container.getBoundingClientRect();
                popupX = (arrowRect.left - containerRect2.left) + arrowRect.width / 2;
                popupY = (arrowRect.top - containerRect2.top) + arrowRect.height / 2;
                popupAnchorIsArrow = true;
            }

            // Position popup (keep inside container)
            const popup = label;
            const popupWidth = popup.offsetWidth;
            const popupHeight = popup.offsetHeight;
            const padding = 10;

            let x = popupX;
            let y = popupY;

            // Prefer to show popup slightly offset from the anchor (e.g. top-right of anchor)
            x += 12;
            y -= popupHeight / 2;

            // Clamp within container
            if (x + popupWidth > containerRect.width - padding) x = containerRect.width - popupWidth - padding;
            if (x < padding) x = padding;
            if (y + popupHeight > containerRect.height - padding) y = containerRect.height - popupHeight - padding;
            if (y < padding) y = padding;

            popup.style.left = x + 'px';
            popup.style.top = y + 'px';
            popup.style.display = 'block';
        } else {
            label.style.display = 'none';
        }
    });

    // Adjust sizes for device and handle resize
    function adjustForDevice() {
        const screenW = document.documentElement.clientWidth;
        const screenH = document.documentElement.clientHeight;

        // Determine star size and arrow size
        let starSize;
        if (isSmallScreen) {
            starSize = Math.round(Math.min(120, Math.max(32, screenW / 5)));
        } else {
            starSize = 40;
        }
        arrowSizeNum = isSmallScreen ? Math.round(Math.min(120, Math.max(32, screenW / 6))) : 40;

        points.forEach(entity => {
            entity.billboard.width = starSize;
            entity.billboard.height = starSize;

            entity.arrowDiv.style.width = arrowSizeNum + 'px';
            entity.arrowDiv.style.height = arrowSizeNum + 'px';
        });

        // UI label adjustments for very small screens
        const label = document.getElementById('uiLabel');
        if (isVerySmallScreen) {
            label.style.width = 'auto';
            label.style.minWidth = '287px';
            label.style.fontSize = '24px';
            label.style.padding = '12px 18px';
            closeBtn.style.padding = '10px 12px';
            closeBtn.style.marginLeft = '30px';
            closeBtn.style.fontSize = '24px';
        } else if (isSmallScreen) {
            label.style.width = 'auto';
            label.style.minWidth = '258px';
            label.style.fontSize = '20px';
            label.style.padding = '11px 16px';
            closeBtn.style.padding = '8px 11px';
            closeBtn.style.marginLeft = '27px';
            closeBtn.style.fontSize = '20px';
        } else {
            label.style.width = 'auto';
            label.style.minWidth = '229px';
            label.style.fontSize = '16px';
            label.style.padding = '9px 14px';
            closeBtn.style.padding = '6px 10px';
            closeBtn.style.marginLeft = '25px';
            closeBtn.style.fontSize = '16px';
        }
    }

    adjustForDevice();
    window.addEventListener('resize', adjustForDevice);
});
