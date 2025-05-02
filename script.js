const width = 800, height = 800;

// 1) 创建 SVG
const svg = d3.select("#map").append("svg")
    .attr("width", width)
    .attr("height", height);

// 2) 变量声明
let geoData, dengueData;

// const baseColors = d3.range(0, 10).map(i => d3.interpolateRainbow(i/10));

let currentIdx = 0;

let isPlaying = false;
let interval = null;

let subInterval = null;

const zoomTransforms = {};

let skipSmoothOnce = false;

const top10Charts = {};

const clickedHistory = [];

let currentData = {};

// 4) 异步加载 GeoJSON + CSV
Promise.all([
    d3.json("data/brazil_microregions_simplified_v3.geojson"),
    d3.csv("data/composed_features.csv", d => {
        const parsed = {
            week_id: +d.week_id,
            micro_code: d.micro_code
        };

        for (const key in d) {
            if (key !== "week_id" && key !== "micro_code") {
                parsed[key] = +d[key];
            }
        }
        return parsed;
    })
]).then(([geo, data]) => {
    geoData = geo;
    dengueData = data;

    const dataByWeekAndCode = d3.rollup(
        dengueData,
        v => v[0],
        d => d.week_id,
        d => d.micro_code
    );
    window.dataByWeekAndCode = dataByWeekAndCode;
    
    const microMeta = {};
    geoData.features.forEach(f => {
        const { CD_MICRO, NM_MICRO, SIGLA } = f.properties;
        microMeta[CD_MICRO] = {
        name: NM_MICRO,
        state: SIGLA
        };
    });

    // helper func for code, name, state
    function getRegionLabel(code) {
        const m = microMeta[code] || {};
        return `${code}: ${m.name || ""} (${m.state || ""})`;
    }

    // 保存到全局，后面 updateTop10Histograms、renderAllSelectedMaps 都能用
    window.microMeta = microMeta;
    window.getRegionLabel = getRegionLabel;

    initMicroRegionSearch({
        microMeta: window.microMeta,
        maxSuggestions: 10,
        maxPool: 5
    });

    // 提取 feature 列表（除 week_id, micro_code）
    const allFeatures = Object.keys(data[0]).filter(k => k !== "week_id" && k !== "micro_code");

    const baseColors = d3.range(0, allFeatures.length).map(i => d3.interpolateRainbow(i / allFeatures.length));

    const featureScales = {};

    // color by number
    allFeatures.forEach((feature, i) => {
        // 1) 拿到这一列所有值并排序
        const vals = data.map(d => d[feature]).sort(d3.ascending);
        // 2) 取 4 个分界线（等分位数）
        const thresholds = [1,2,3,4].map(k => d3.quantile(vals, k / 5));
        // 3) 构造 domain，6 个点：min, t1, t2, t3, t4, max
        const domain = [ d3.min(vals), ...thresholds, d3.max(vals) ];
        // 4) 为每一段生成 6 色渐变，从白到基色
        const base = baseColors[i]; 
        const stops = d3.range(domain.length)
                        .map(j => d3.interpolateRgb("#fff", base)(j / (domain.length - 1)));
        // 5) 建立线性比例尺
        featureScales[feature] = d3.scaleLinear()
                                .domain(domain)
                                .range(stops);
    });

    const legendData = {};
    allFeatures.forEach(feature => {
        const scale = featureScales[feature];
        legendData[feature] = {
            domain: scale.domain(),   // [min, t1, t2, t3, t4, max]
            colors: scale.range()     // 对应的 6 色渐变数组
        };
    });
    window.legendData = legendData;

    // color by value
    // allFeatures.forEach((feature, i) => {
    //     const vals = data.map(d => d[feature]).filter(v => !isNaN(v));

    //     const min = d3.min(vals);
    //     const max = d3.max(vals);

    //     // 等间距划分成 5 段 → 共6个点
    //     const domain = d3.range(6).map(j => min + j * (max - min) / 5);

    //     // 基础色
    //     const base = baseColors[i];
    //     const stops = d3.range(6).map(j => d3.interpolateRgb("#fff", base)(j / 5));

    //     featureScales[feature] = d3.scaleLinear()
    //         .domain(domain)
    //         .range(stops);

    //     console.log(`Feature: ${feature}`);
    //     console.log(`Domain: [${domain.map(d => d.toFixed(2)).join(", ")}]`);
    // });

    window.featureScales = featureScales;

    // 创建 checkboxes
    const checkGroup = d3.select("#featureChecks");
    checkGroup.selectAll("label")
        .data(allFeatures)
        .enter()
        .append("label")
        .style("margin-right", "12px")
        .html(d => `<input type="checkbox" name="feature" value="${d}"> ${abbFeatureName(d)}`);



    // 默认勾选 dengue
    d3.select(`#featureChecks input[value="dengue"]`).property("checked", true);


    // 设置滑块的最小/最大值
    const weeks = Array.from(new Set(data.map(d => d.week_id)))
                   .sort((a,b) => a - b);

    setupFeatureCheckboxListener(weeks, renderAllSelectedMaps);

    setupPlaybackControls(weeks, renderAllSelectedMaps);

    setupCustomProgressBar(weeks, renderAllSelectedMaps);

    setupYearTicks(weeks);


    const yearWeekList = calculateWeek(weeks[0]);
    d3.select("#yearLabel").text(yearWeekList[0]);
    d3.select("#weekLabel").text(yearWeekList[1]);

    // d3.select("#weekLabel").text(weeks[0]);
    renderAllSelectedMaps(["dengue"], weeks[0]);

});




const mapGroups = {};  

function renderAllSelectedMaps(selectedFeatures, week, enableTrasition = false) {
    window.currentWeekId = week;

    const container = d3.select("#map-container");

    Object.keys(mapGroups).forEach(feature => {
        if (!selectedFeatures.includes(feature)) {
            // 1) 从 DOM 上移除对应的 div
            container.select(`#map-${feature}`).remove();
            // 2) 删掉保存在 mapGroups 里的引用
            delete mapGroups[feature];
        }
    });
    // 构建当前周的数据查表
    const currentData = Object.fromEntries(
        dengueData
        .filter(d => d.week_id === week)
        .map(d => [d.micro_code, d])
    );

    selectedFeatures.forEach(feature => {
        // 1) 如果还没初始化这一张图，就建一次 DOM
        if (!mapGroups[feature]) {
            const mapDiv = container.append("div")
                .attr("id", `map-${feature}`)
                .attr("class", "vis-block")
                .style("flex", "1 1 calc(25% - 20px)")
                .style("max-width", "670.34px")
                .style("min-width", "250px");

            const featureName = abbFeatureName(feature)

            mapDiv.append("div")
                .text(featureName)
                .style("font-weight", "bold")
                .style("margin-bottom", "5px");

            const svg = mapDiv.append("svg")
                .attr("width", width)
                .attr("height", height);

            const g = svg.append("g");
            // 绑定 zoom 行为一次
            svg.call(makeZoomBehavior(feature, g));
            // 如果之前有保存的 transform，就恢复
            if (zoomTransforms[feature]) {
                svg.call(d3.zoom().transform, zoomTransforms[feature]);
            }

            // 创建 path（只做一次 enter）
            // const projection = d3.geoMercator()
            //                     .fitSize([width, height], geoData)
            //                     .translate([width/2 + 800, height/2-200]);
                                
            const projection = d3.geoMercator().fitSize([width, height], geoData);
            const pathGen = d3.geoPath().projection(projection);

            const paths = g.selectAll("path")
                .data(geoData.features, d => d.properties.CD_MICRO)
                .enter()
                .append("path")
                .attr("d", pathGen)
                .attr("stroke", "#999")
                .attr("stroke-width", 0.5)
                .attr("fill-opacity", 0.85)
                .classed("micro_region", true)
                .on("click", (event,d) => {
                    if (event.defaultPrevented) return;
                    // console.log("Clicked:", d.properties.CD_MICRO);
                    const code = d.properties.CD_MICRO;
                    const info = microMeta[code];

                    // 如果已有，先移除再添加到最前面
                    const existingIdx = clickedHistory.findIndex(e => e.code === code);
                    if (existingIdx !== -1) {
                        clickedHistory.splice(existingIdx, 1);
                    }
                    clickedHistory.unshift({ code, ...info });

                    // 保持最多 10 个
                    // if (clickedHistory.length > 10) {
                    //     clickedHistory.pop();
                    // }

                    renderClickHistory();
                })
                .on("mouseover", (event,d) => {
                    window.lastHoveredCode = d.properties.CD_MICRO;
                    window.lastHoveredPos  = { x: event.pageX, y: event.pageY };
                    updateTooltip(event, d);
                })
                .on("mousemove", (event,d) => {
                    window.lastHoveredPos = { x: event.pageX, y: event.pageY };
                    updateTooltip(event, d);
                })
                .on("mouseout", () => {
                    window.lastHoveredCode = null;
                    d3.select("#tooltip").style("display", "none");
                });
            
            drawLegend(svg, feature);
            // 记下来以便后面只更新 fill
            mapGroups[feature] = {g, paths};
        }

        // 2) 更新这张图的 fill
        const color = featureScales[feature];

        if(enableTrasition){
            mapGroups[feature].g.selectAll("path")
                        .transition()
                        .duration(500)
                        .attr("fill", d => {
                            const code = d.properties.CD_MICRO;
                            return color((currentData[code] || {})[feature] || 0);
                        });
        }else{
            mapGroups[feature].g.selectAll("path")
                        .attr("fill", d => {
                            const code = d.properties.CD_MICRO;
                            return color((currentData[code] || {})[feature] || 0);
                        });
        }

        // mapGroups[feature].g.selectAll("path")
        //                 .attr("fill", d => {
        //                     const code = d.properties.CD_MICRO;
        //                     return color((currentData[code] || {})[feature] || 0);
        //                 });
    });

    if (window.lastHoveredCode) {
        // find the feature object for that code
        const f = geoData.features.find(f => f.properties.CD_MICRO === window.lastHoveredCode);
        // simulate an event at the last mouse position
        const pseudoEvent = { pageX: window.lastHoveredPos.x, pageY: window.lastHoveredPos.y };
        updateTooltip(pseudoEvent, f);
    }

    updateTop10Histograms(selectedFeatures, week);
}



// function renderAllSelectedMaps(selectedFeatures, week, enableTransition = false) {
//   // 每次渲染都更新全局 currentWeekId
//   window.currentWeekId = week;

//   const container = d3.select("#map-container");

//   // 1) 删除已取消的 map 块
//   Object.keys(mapGroups).forEach(feature => {
//     if (!selectedFeatures.includes(feature)) {
//       container.select(`#map-${feature}`).remove();
//       delete mapGroups[feature];
//     }
//   });

//   // 2) 构建当前周的数据查表，便于快速查 record
//   const currentData = Object.fromEntries(
//     dengueData
//       .filter(d => d.week_id === week)
//       .map(d => [d.micro_code, d])
//   );

//   selectedFeatures.forEach(feature => {
//     let g;

//     // 3) 首次初始化 DOM
//     if (!mapGroups[feature]) {
//       const mapDiv = container.append("div")
//         .attr("id", `map-${feature}`)
//         .attr("class", "vis-block")
//         .style("flex", "1 1 calc(25% - 20px)")
//         .style("max-width", "670.34px")
//         .style("min-width", "250px");

//       mapDiv.append("div")
//         .text(abbFeatureName(feature))
//         .style("font-weight", "bold")
//         .style("margin-bottom", "5px");

//       const svg = mapDiv.append("svg")
//         .attr("width", width)
//         .attr("height", height);

//         const g = svg.append("g");
//         const zoomBehavior = makeZoomBehavior(feature, g);
//         svg.call(zoomBehavior);

//     //   svg.call(makeZoomBehavior(feature, svg.append("g")));


//       // restore zoom if any
//       if (zoomTransforms[feature]) {
//         svg.call(d3.zoom().transform, zoomTransforms[feature]);
//       }

//       const projection = d3.geoMercator().fitSize([width, height], geoData);
//       const pathGen = d3.geoPath().projection(projection);

//     //   g = svg.append("g");

//       // enter(): 只做一次 append path
//       g.selectAll("path")
//         .data(geoData.features, d => d.properties.CD_MICRO)
//         .enter().append("path")
//           .attr("d", pathGen)
//           .attr("stroke", "#999")
//           .attr("stroke-width", 0.5)
//           .attr("fill-opacity", 0.85)
//           .classed("micro_region", true)
//           .on("click", (event, d) => {
//             if (event.defaultPrevented) return;
//             const code = d.properties.CD_MICRO;
//             const info = microMeta[code];
//             const idx = clickedHistory.findIndex(e => e.code === code);
//             if (idx !== -1) clickedHistory.splice(idx, 1);
//             clickedHistory.unshift({ code, ...info });
//             if (clickedHistory.length > 50) clickedHistory.pop();
//             renderClickHistory();
//           });

//       drawLegend(svg, feature);

//       // 存一下 g，以后复用
//       mapGroups[feature] = g;
//     } else {
//       g = mapGroups[feature];
//     }

//     // 4) 更新颜色
//     const color = featureScales[feature];
//     const paths = g.selectAll("path");
//     if (enableTransition) {
//       paths.transition().duration(500)
//         .attr("fill", d => {
//           const code = d.properties.CD_MICRO;
//           return color((currentData[code] || {})[feature] || 0);
//         });
//     } else {
//       paths.attr("fill", d => {
//         const code = d.properties.CD_MICRO;
//         return color((currentData[code] || {})[feature] || 0);
//       });
//     }

//     // 5) 重新绑定 tooltip 事件 —— 始终用 currentData[code]，不会锁死在某一帧
//     paths
//         .on("mouseover", (event,d) => {
//             window.lastHoveredCode = d.properties.CD_MICRO;            // ← 记录当前 hover code
//             window.lastHoveredPos  = { x: event.pageX, y: event.pageY }; // ← 记录坐标
//             updateTooltip(event, d, currentData);                       // ← 第一次 render
//         })
//         .on("mousemove", (event,d) => {
//             window.lastHoveredPos = { x: event.pageX, y: event.pageY }; // 更新位置
//             updateTooltip(event, d, currentData);                       // 继续 render
//         })
//         .on("mouseout", () => {
//             window.lastHoveredCode = null;                              // 清空
//             d3.select("#tooltip").style("display", "none");
//         });
//   });
//   if (window.lastHoveredCode) {
//     // 构造一个“虚拟”的 d 和 event
//     const pseudoD     = { properties: { CD_MICRO: window.lastHoveredCode } };
//     const pseudoEvent = {
//       pageX: window.lastHoveredPos.x,
//       pageY: window.lastHoveredPos.y
//     };


//     updateTooltip(pseudoEvent, pseudoD, Object.fromEntries(
//       dengueData
//         .filter(d => d.week_id === week)
//         .map(d => [d.micro_code, d])
//     ));

//     // setTimeout(() => {
//     //     updateTooltip(pseudoEvent, pseudoD, Object.fromEntries(
//     //         dengueData
//     //             .filter(d => d.week_id === week)
//     //             .map(d => [d.micro_code, d])
//     //     ));
//     // }, 50);

//   }

//   // 6) 更新 Top10
//   updateTop10Histograms(selectedFeatures, week);
// }



function setupFeatureCheckboxListener(weeks, renderAllSelectedMaps) {
    d3.selectAll("#featureChecks input").on("change", function () {
        const selected = d3.selectAll("#featureChecks input")
            .filter(function () { return this.checked; })
            .nodes()
            .map(n => n.value);

        // const currentIdx = +d3.select("#weekSlider").property("value");
        const week = weeks[currentIdx];
        renderAllSelectedMaps(selected, week);
    });
}

function makeZoomBehavior(feature, g) {
    return d3.zoom()
        .scaleExtent([0.45, 8])
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
            zoomTransforms[feature] = event.transform;
        });
}


function startAutoPlay(weeks, renderMapFn) {
    if (isPlaying) return;
    isPlaying = true;
    skipSmoothOnce = false;
    d3.select("#playButton").text("⏸");
    interval = setInterval(() => {
        const maxIdx = weeks.length - 1;
        const prevIdx = currentIdx;

        // currentIdx = (currentIdx + 1) > maxIdx ? 0 : currentIdx + 1;
        if (currentIdx < maxIdx) {
            currentIdx++;
        } else {
            // 已经到最后一帧 → 停止播放
            stopAutoPlay();
            return;   // 不再执行后续渲染
        }


        const realWeek = weeks[currentIdx];

        const yearWeekList = calculateWeek(realWeek);
        d3.select("#yearLabel").text(yearWeekList[0]);
        d3.select("#weekLabel").text(yearWeekList[1]);


        // d3.select("#weekLabel").text(realWeek);
        const selected = d3.selectAll("#featureChecks input")
                            .filter(function() { return this.checked; })
                            .nodes().map(n => n.value);
        renderMapFn(selected, realWeek, true);
        updateProgressBar(currentIdx, weeks.length);

        // tween
        clearInterval(subInterval);
        if (!skipSmoothOnce) {
        smoothAdvance(prevIdx, currentIdx, weeks);
        } else {
        skipSmoothOnce = false;
        }
    }, 1000);
}

function stopAutoPlay() {
    if (!isPlaying) return;
    clearInterval(interval);
    isPlaying = false;
    d3.select("#playButton").text("▶");
}


function setupPlaybackControls(weeks, renderMapFn) {
    // let isPlaying = false;
    // let interval = null;


    const playButton = d3.select("#playButton");
    playButton.on("click", () => {
        if (isPlaying) {
            stopAutoPlay();
        } else {
            if (currentIdx === weeks.length - 1) {
                currentIdx = 0;
                // 更新界面到第一帧
                // const firstWeek = weeks[0];

                const yearWeekList = calculateWeek(weeks[0]);
                d3.select("#yearLabel").text(yearWeekList[0]);
                d3.select("#weekLabel").text(yearWeekList[1]);


                // d3.select("#weekLabel").text(weeks[0]);
                updateProgressBar(0, weeks.length);
                const selected = d3.selectAll("#featureChecks input")
                                    .filter(function() { return this.checked; })
                                    .nodes().map(n => n.value);
                renderMapFn(selected, weeks[0]);
            }      
            startAutoPlay(weeks, renderMapFn);
        }
    });
}


function setupCustomProgressBar(weeks, renderMapFn) {
    const wrapper = d3.select("#progressBarWrapper");
    const fill = d3.select("#progressBarFill");

    let isDragging = false;
    let wasPlayingBeforeDrag = false;

    function updateFromX(x) {
        const rect = wrapper.node().getBoundingClientRect();
        const percent = Math.min(Math.max(x / rect.width, 0), 1);
        const idx = Math.round(percent * (weeks.length - 1));

        currentIdx = idx;

        const yearWeekList = calculateWeek(weeks[idx]);
        d3.select("#yearLabel").text(yearWeekList[0]);
        d3.select("#weekLabel").text(yearWeekList[1]);

        // d3.select("#weekLabel").text(weeks[idx]);

        const selected = d3.selectAll("#featureChecks input")
                            .filter(function () { return this.checked; })
                            .nodes()
                            .map(n => n.value);

        renderMapFn(selected, weeks[idx]);
        updateProgressBar(idx, weeks.length, true);
    }

    const dragger = d3.drag()
        .on("start", (event) => {
            // —— 这里放你所有“拖动开始要做的事” —— 
            clearInterval(subInterval);    // 停掉平滑补间
            wasPlayingBeforeDrag = isPlaying;
            if (isPlaying) {
                stopAutoPlay();
            }
            skipSmoothOnce = true;         // 如果你之前用过这个 flag
            d3.select("body").style("user-select", "none");
            updateFromX(event.x);
        })
        .on("drag", (event) => {
            // 一直拖到哪儿就去哪儿
            updateFromX(event.x);
        })
        .on("end", () => {
            d3.select("body").style("user-select", null);
            if (wasPlayingBeforeDrag) {
                // 恢复播放
                // skipSmoothOnce = true;
                // d3.select("#playButton").dispatch("click");
                startAutoPlay(weeks, renderMapFn);
            }
        });

    wrapper.call(dragger);
}

function updateProgressBar(currentIdx, total, immediate = false) {
    const progress = (currentIdx / (total - 1)) * 100;
    const bar = d3.select("#progressBarFill");

    if (immediate) {
        bar.style("transition", "none");
    } else {
        bar.style("transition", "width 0.3s linear");
    }

    bar.style("width", `${progress}%`);
}

function smoothAdvance(fromIdx, toIdx, weeks) {
    let frame = 0;
    const totalFrames = 30;  // 越大越平滑
    const start = fromIdx;
    const end = toIdx;

    clearInterval(subInterval);

    subInterval = setInterval(() => {
        frame++;
        const t = frame / totalFrames;
        const progress = start + (end - start) * t;

        updateProgressBar(progress, weeks.length);

        if (frame >= totalFrames) {
            clearInterval(subInterval);
        }
    }, 1000 / totalFrames);
}

function calculateWeek(passedWeek){
    let year = Math.floor(passedWeek/100);
    let week = passedWeek%100;
    return [year, week]
}

function abbFeatureName(name){
    const nameMap = {
        dengue: "Num Dengue Cases",
        pressure: "Pressure",
        rainy_days: "Num Rainy Days",
        precipitation: "Precipitation",
        temperature_max: "Max Temperature",
        temperature_min: "Min Temperature",
        wind_speed: "Wind Speed",
        temperature_mean: "Avg Temperature",
        humidity: "Humidity",
        ndvi: "Normalized Difference Vegetation Index"
    };

    return nameMap[name] || "UNKNOWN";
}


d3.select("#toggleTop10Btn").on("click", () => {
    const container = d3.select("#top10Container");
    const visible = container.style("display") !== "none";
    container.style("display", visible ? "none" : "flex");
    d3.select("#toggleTop10Btn").text(visible ? "Show Top 10 Regions" : "Hide Top 10 Regions");
});


function updateTop10Histograms(selectedFeatures, week) {
    const container = d3.select("#top10Container");

    // 1) 移除不再勾选的 chart block
    Object.keys(top10Charts).forEach(feature => {
        if (!selectedFeatures.includes(feature)) {
            container.select(`#top10-${feature}`).remove();
            delete top10Charts[feature];
        }
    });

    const currentData = dengueData.filter(d => d.week_id === week);
    const width = 300, height = 250;
    const margin = { top: 10, right: 60, bottom: 30, left: 160 };

    selectedFeatures.forEach(feature => {
        // 找到或新建容器 block
        let block = container.select(`#top10-${feature}`);
        if (block.empty()) {
            block = container.append("div")
                            .attr("id", `top10-${feature}`)
                            .attr("class", "vis-block")
                            .style("flex", "1 1 calc(25% - 20px)")
                            .style("max-width", "335.17px")
                            .style("min-width", "250px");

            // 缓存这个 block
            top10Charts[feature] = true;
        }

        // **先移除旧的 SVG**，再一路重建 title、bars、axis
        block.select("svg").remove();

        const svg = block.append("svg")
                        .attr("width", width)
                        .attr("height", height);

        // 标题
        svg.append("text")
            .attr("x", width/2).attr("y", margin.top + 4)
            .attr("text-anchor", "middle")
            .style("font-weight", "bold")
            .text(abbFeatureName(feature));

        const top10 = [...currentData].filter(d => !isNaN(d[feature]))
                                    .sort((a,b) => b[feature] - a[feature])
                                    .slice(0,10);

        const x = d3.scaleLinear()
                    .domain([0, d3.max(top10,d=>d[feature])])
                    .range([0, width - margin.left - margin.right]);

        const y = d3.scaleBand()
                    .domain(top10.map(d=>d.micro_code))
                    .range([margin.top, height - margin.bottom])
                    .padding(0.1);

        const g = svg.append("g")
                    .attr("transform", `translate(${margin.left},10)`);

        // bars
        g.selectAll("rect")
            .data(top10)
            .enter().append("rect")
                    .attr("y", d=>y(d.micro_code))
                    .attr("height", y.bandwidth())
                    .attr("width", d=>x(d[feature]))
                    .attr("fill", d=>featureScales[feature](d[feature] || 0));

        // bar labels
        g.selectAll(".bar-label")
            .data(top10)
            .enter().append("text")
                    .attr("class","bar-label")
                    .attr("x", d=>x(d[feature])+4)
                    .attr("y", d=>y(d.micro_code) + y.bandwidth()/2 + 4)
                    .text(d=>d[feature].toFixed(1))
                    .style("font-size","10px");

        // y-axis
        const yAxis = d3.axisLeft(y)
                        .tickFormat(d=> getRegionLabel(d));
        g.append("g").call(yAxis)
                    .selectAll("text")
                        .style("font-size","10px");
    });
}


function renderClickHistory() {
    const list = d3.select("#clickedList");
    list.html("");  // 清空旧内容

    // const title = container.append("h3").text("Micro-regions You've Viewed:");

    // const list = container.append("ul");

    clickedHistory.slice(0,50).forEach(entry => {
        list.append("li").text(
            `${entry.code} – ${entry.name} (${entry.state})`
        );
    });
}



function drawLegend(svg, feature) {
    const { domain, colors } = window.legendData[feature];
    const legendG = svg.append("g")
        .attr("class", "legend");
    const legendWidth = 12;
    const legendHeight = 120;
    const steps = domain.length - 1;
    const stepH = legendHeight / steps;
    const offsetX = 8;
    const offsetY = height - legendHeight - 600;

    // 画色块和文字
    for (let i = 0; i < steps; i++) {
        legendG.append("rect")
        .attr("x", offsetX)
        .attr("y", offsetY + stepH * (steps - i - 1))
        .attr("width", legendWidth)
        .attr("height", stepH)
        .attr("fill", colors[i]);

        legendG.append("text")
        .attr("x", offsetX + legendWidth + 4)
        .attr("y", offsetY + stepH * (steps - i - 1) + stepH/2 + 4)
        .style("font-size", "10px")
        .text(domain[i].toFixed(1));
    }
    // 最上面标 max
    legendG.append("text")
        .attr("x", offsetX + legendWidth + 4)
        .attr("y", offsetY + 4)
        .style("font-size", "10px")
        .text(domain[domain.length - 1].toFixed(1));
}


d3.select("#genLineBtn").on("click", () => {
    // 如果还没生成 checkbox，就生成
    const controls = d3.select("#lineControls");
    if (controls.selectAll("input").empty()) {
        const allFeatures = Object.keys(dengueData[0])
                                    .filter(k => k !== "week_id" && k !== "micro_code");
        allFeatures.forEach((feature, i) => {
            const chkId = `linechartCheckbox-${feature}`;
            const lbl = controls.append("label");
            lbl.append("input")
                .attr("id", chkId)
                .attr("type","checkbox")
                .attr("value",feature)
                .property("checked", feature === "dengue");
            lbl.append("span").text(abbFeatureName(feature));
        });
        controls.selectAll("input").on("change", updateLineCharts);
    }
    // 画图
    updateLineCharts();
});

// 点 “Remove All Graphs” 直接清空 controls + charts
d3.select("#clearLineBtn").on("click", () => {
    d3.select("#lineControls").html("");
    d3.select("#lineChartContainer").html("");
    d3.select("#lineLegend").html("");
});


function updateLineCharts() {
    const selectedFeatures = d3.selectAll("#lineControls input:checked").nodes()
        .map(n => n.value);
    const regions = window.selectedRegions;
    const container = d3.select("#lineChartContainer");
    const legendDiv = d3.select("#lineLegend");

  // —— 1) 容器居中 —— 
//   container
//     .style("display", "flex")
//     .style("flex-wrap", "wrap")
//     .style("justify-content", "center")
//     .style("gap", "20px");

  // 清空旧内容
    legendDiv.html("");
    container.html("");
    if (!regions.length || !selectedFeatures.length) return;

    // 统一 color scale
    const color = d3.scaleOrdinal(d3.schemeCategory10)
        .domain(regions);

    // 2) 渲染全局 Legend
    regions.forEach(region => {
        const item = legendDiv.append("div").attr("class","line-legend-item");
        item.append("div")
            .attr("class","line-legend-color")
            .style("background", color(region));
        item.append("span").text(region);
    });

    // 3) 准备数据和比例尺
    const margin = { top: 30, right: 20, bottom: 30, left: 40 };
    const w = 320, h = 200;

    // 收集所有周，并排序
    const allWeeks = Array.from(
        new Set(
        dengueData
            .filter(d => regions.includes(d.micro_code))
            .map(d => d.week_id)
        )
    ).map(Number).sort((a,b)=>a-b);

    // 按 region/week 聚合
    const byRegionWeek = {};
    dengueData
        .filter(d => regions.includes(d.micro_code))
        .forEach(d => {
        const code = d.micro_code;
        if (!byRegionWeek[code]) byRegionWeek[code] = {};
        const rec = byRegionWeek[code];
        if (!rec[d.week_id]) rec[d.week_id] = { count: 0 };
        rec[d.week_id].count++;
        selectedFeatures.forEach(f => {
            rec[d.week_id][f] = (rec[d.week_id][f] || 0) + d[f];
        });
        });

    // 4) 每个 feature 画一个 small‑multiple
    selectedFeatures.forEach(feature => {
        const chartDiv = container.append("div")
            .attr("class","line-chart")
            .style("width", "350px")
            .style("flex", "none");

        const svg = chartDiv.append("svg")
        .attr("width", w)
        .attr("height", h);

        // 构造每个 region 的时序平均值数组
        const dataByRegion = {};
        regions.forEach(code => {
        const rec = byRegionWeek[code] || {};
        dataByRegion[code] = allWeeks.map(week => ({
            week,
            value: rec[week]
                ? rec[week][feature] / rec[week].count
                : 0
        }));
        });

        // x：完整 week_id，tick 只显示年份
        const x = d3.scaleLinear()
        .domain(d3.extent(allWeeks))
        .range([margin.left, w - margin.right]);

        // const xAxis = d3.axisBottom(x)
        //   .ticks(4)
        //   .tickFormat(d => Math.floor(d / 100));

        const xAxis = d3.axisBottom(x)
                        .ticks(4)
                        .tickFormat(d => {
                            const s = d.toString();
                            return s.length >= 4 ? s.slice(0, 4) : s;
                        });

        // y：根据所有 region 的值来 nice()
        const allVals = regions.flatMap(code =>
        dataByRegion[code].map(d => d.value)
        );
        const y = d3.scaleLinear()
        .domain(d3.extent(allVals)).nice()
        .range([h - margin.bottom, margin.top]);

        const yAxis = d3.axisLeft(y).ticks(4);

        const g = svg.append("g").attr("transform", `translate(15,0)`);

        g.append("g")
                .attr("transform", `translate(0,${h - margin.bottom})`)
                .call(xAxis);

        g.append("g")
                .attr("transform", `translate(${margin.left},0)`)
                .call(d3.axisLeft(y).ticks(4));

        const lineGen = d3.line()
                        .x(d => x(d.week))
                        .y(d => y(d.value));

        regions.forEach(region => {
            g.append("path")
                .datum(dataByRegion[region])
                .attr("fill", "none")
                .attr("stroke", color(region))
                .attr("stroke-width", 1.2)
                .attr("d", lineGen);
        });


        svg.append("text")
        .attr("x", w / 2)
        .attr("y", margin.top - 10)
        .attr("text-anchor", "middle")
        .style("font-size","12px")
        .style("font-weight","bold")
        .text(abbFeatureName(feature));
    });
}


function setupYearTicks(weeks) {
    const yearTicks = d3.select("#progressYearTicks");
    yearTicks.html(""); // 清空旧内容

    const yearWeekCounts = {
        2014: 53, 2015: 52, 2016: 52, 2017: 52, 2018: 52,
        2019: 52, 2020: 53, 2021: 52, 2022: 52, 2023: 52, 2024: 52
    };

    const totalWeeks = weeks.length;
    let weekIndex = 0;

    Object.entries(yearWeekCounts).forEach(([year, count]) => {
        const leftPercent = (weekIndex / (totalWeeks - 1)) * 100;

        yearTicks.append("div")
            .style("position", "absolute")
            .style("left", `${leftPercent}%`)
            .style("transform", "translateX(-50%)")
            .style("font-size", "10px")
            .style("color", "#666")
            .text(year);

        weekIndex += count;
    });
}


// function updateTooltip(event, d, currentData) {
//     const code   = d.properties.CD_MICRO;
//     const info   = microMeta[code] || {};
//     const record = currentData[code];

//     const year = Math.floor(window.currentWeekId / 100);
//     const week = window.currentWeekId % 100;

//     let html = `<strong>${code}</strong> ${info.name} (${info.state})<br>`;
//     html += `<em>Year:</em> ${year}, <em>Week:</em> ${week}`;
    
//     if (record) {
//         html += "<br><br>" + Object.entries(record)
//         .filter(([k]) => k!=="micro_code" && k!=="week_id")
//         .map(([k,v]) => `${abbFeatureName(k)}: ${v.toFixed(2)}`)
//         .join("<br>");
//     }

//     d3.select("#tooltip")
//         .html(html)
//         .style("display", "block")
//         .style("left", `${event.pageX + 10}px`)
//         .style("top",  `${event.pageY + 10}px`);
// }


function updateTooltip(event, d) {
    const code = d.properties.CD_MICRO;
    const info = microMeta[code] || {};

    const weekId = window.currentWeekId;

    const year = Math.floor(weekId / 100);
    const week = weekId % 100;

    const record =  window.dataByWeekAndCode.get(weekId)?.get(code);

    let html = `<strong>${code}</strong> ${info.name} (${info.state})<br>`;
    html += `<em>Year:</em> ${year}, <em>Week:</em> ${week}`;
    
    if (record) {
        html += "<br><br>" + Object.entries(record)
        .filter(([k]) => k!=="micro_code" && k!=="week_id")
        .map(([k,v]) => `${abbFeatureName(k)}: ${v.toFixed(2)}`)
        .join("<br>");
    }

    d3.select("#tooltip")
        .html(html)
        .style("display", "block")
        .style("left",  (window.lastHoveredPos.x + 10) + "px")
        .style("top",   (window.lastHoveredPos.y + 10) + "px");
}