var start_time = null
var item_list = null
var order_info = null

function state_init() {
    start_time = new Date()
    item_list = []
    order_info = {
        year_list: [],
        count_total: 0,
        count_done: 0,
        price_total: 0,
        by_year: {},
        by_category: {
            kindle: { count: 0, price: 0 },
            digital: { count: 0, price: 0 },
            physical: { count: 0, price: 0 }
        }
    }

    document.getElementById('status').value = ''
    notify_progress()
}

function year_index(year) {
    index = 0
    for (y of order_info['year_list']) {
        if (y == year) {
            return index
        }
        index++
    }
}

function notify_progress() {
    document.getElementById('order_count_done').innerText = order_info['count_done'].toLocaleString()
    document.getElementById('order_count_total').innerText = order_info['count_total'].toLocaleString()
    document.getElementById('order_price_total').innerText = order_info['price_total'].toLocaleString()

    // カテゴリ別の表示を更新
    const cat = order_info['by_category']
    document.getElementById('category_kindle_price').innerText = cat['kindle']['price'].toLocaleString()
    document.getElementById('category_kindle_count').innerText = cat['kindle']['count'].toLocaleString()
    document.getElementById('category_digital_price').innerText = cat['digital']['price'].toLocaleString()
    document.getElementById('category_digital_count').innerText = cat['digital']['count'].toLocaleString()
    document.getElementById('category_physical_price').innerText = cat['physical']['price'].toLocaleString()
    document.getElementById('category_physical_count').innerText = cat['physical']['count'].toLocaleString()

    var done_rate
    if (order_info['count_done'] == 0) {
        done_rate = 0
    } else {
        done_rate = (100 * order_info['count_done']) / order_info['count_total']
    }

    progress_bar = document.getElementById('progress_bar')
    progress_bar.innerText = Math.round(done_rate) + '%'
    progress_bar.style.width = Math.round(done_rate) + '%'

    if (done_rate > 0.1) {
        now = new Date()
        elapsed_sec = Math.round((now.getTime() - start_time.getTime()) / 1000)
        remaining_sec = (elapsed_sec / done_rate) * (100 - done_rate)

        var remaining_text
        if (remaining_sec < 300) {
            remaining_text = Math.round(remaining_sec) + '秒'
        } else {
            remaining_text = Math.round(remaining_sec / 60).toLocaleString() + '分'
        }

        document.getElementById('remaining_time').innerText = remaining_text
    } else {
        document.getElementById('remaining_time').innerText = '?'
    }
    chart_order_update()
}

function getNewFileHandle() {
    const options = {
        types: [
            {
                description: 'CSV Files',
                accept: {
                    'text/csv': ['.csv']
                }
            }
        ]
    }
    return window.showSaveFilePicker(options)
}

function csv_escape(str) {
    if (typeof str === 'string') {
        if (str.includes('"') || str.includes(',')) {
            return '"' + str.replace(/"/g, '""') + '"'
        } else {
            return str
        }
    } else {
        return str
    }
}

function csv_convert(item_list) {
    content_list = [
        // NOTE: エンコーディングが UTF-8 固定になるので，Excel で開いたときの文字化け防止のため，
        // 先頭に BOM をつける．
        new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array([0xef, 0xbb, 0xbf]))
    ]
    console.log(content_list)
    param_list = [
        ['date', '購入日'],
        ['name', '名前'],
        ['category', 'カテゴリ'],
        ['quantity', '数量'],
        ['price', '価格'],
        ['seller', '販売元'],
        ['asin', 'asin'],
        ['url', 'URL'],
        ['img_url', 'サムネイルURL']
    ]
    for (param of param_list) {
        content_list.push(csv_escape(param[1]))
        content_list.push(', ')
    }
    content_list.pop()
    content_list.push('\n')

    for (item of item_list) {
        for (param of param_list) {
            content_list.push(csv_escape(item[param[0]]))
            content_list.push(',')
        }
        content_list.pop()
        content_list.push('\n')
    }
    return content_list.join('')
}

async function write(item_list) {
    const handle = await getNewFileHandle()

    const writable = await handle.createWritable()
    await writable.write(csv_convert(item_list))
    //    await writable.write(JSON.stringify(data))
    await writable.close()
}

document.getElementById('save').onclick = function () {
    write(item_list)
}

// 実行順序を保ちながら非同期でリストに対して処理を実行
function async_loop(list, index, func, next) {
    return new Promise(function (resolve, reject) {
        if (index == list.length) {
            return resolve(false)
        }
        func(list[index], index, function () {
            return resolve(true)
        })
    }).then(function (is_continue) {
        if (is_continue) {
            return async_loop(list, index + 1, func, next)
        } else {
            next()
        }
    })
}

function get_detail_in_order(order, index, mode, year, callback) {
    cmd_handle(
        {
            to: 'background',
            type: 'parse',
            target: 'detail',
            date: order['date'],
            index: index,
            mode: mode,
            url: order['url']
        },
        function (response) {
            order_info['count_done'] += 1

            if (typeof response === 'undefined') {
                status_error('意図しないエラーが発生しました．')
                log.trace('BUG?')
                return callback()
            }
            for (item of response['list']) {
                item['date'] = response['date']
                item_list.push(item)
                order_info['price_total'] += item['price']
                order_info['by_year']['price'][year_index(year)] += item['price']

                // カテゴリ別の集計
                const category = item['category'] || 'physical'
                if (order_info['by_category'][category]) {
                    order_info['by_category'][category]['count'] += item['quantity'] || 1
                    order_info['by_category'][category]['price'] += item['price']
                }

                chart_order_update()
            }
            notify_progress()
            callback(response)
        }
    )
}

function get_item_in_year(year, page, callback) {
    cmd_handle(
        {
            to: 'background',
            type: 'parse',
            target: 'list',
            year: year,
            page: page,
            page_total: Math.ceil(order_info['by_year']['count'][year_index(year)] / 10)
        },
        function (response) {
            return new Promise(function (resolve) {
                async_loop(
                    response['list'],
                    0,
                    function (order, index, order_callback) {
                        var mode = 0
                        if (index == 0) {
                            mode |= 0x01
                        }
                        if (index == response['list'].length - 1) {
                            mode |= 0x10
                        }
                        get_detail_in_order(order, index, mode, year, order_callback)
                    },
                    function () {
                        if (response['is_last']) {
                            callback()
                        } else {
                            return get_item_in_year(year, page + 1, callback)
                        }
                    }
                )
            })
        }
    )
}

function get_order_count_in_year(year, callback) {
    cmd_handle(
        {
            to: 'background',
            type: 'parse',
            target: 'order_count',
            year: year
        },
        function (response) {
            order_info['count_total'] += response['count']
            order_info['by_year']['count'][year_index(year)] = response['count']

            notify_progress()
            callback()
        }
    )
}

async function get_year_list() {
    new Promise((resolve) => {
        cmd_handle(
            {
                to: 'background',
                type: 'parse',
                target: 'year_list'
            },
            function (response) {
                // NOTE: for DEBUG
                // response['list'] = [2013, 2012, 2011, 2010, 2009, 2008, 2007]
                // response['list'] = [2002, 2001]
                // response['list'] = [2005,2004,2003,2002,2001]

                var target = parseInt(document.getElementById('target').value, 10)
                year_list = response['list']
                if (target != 0) {
                    year_list = year_list.slice(0, target)
                }

                order_info['year_list'] = year_list

                order_info['by_year']['count'] = new Array(year_list.length).fill(0)
                order_info['by_year']['price'] = new Array(year_list.length).fill(0)

                chart_order_create(order_info)
                resolve(year_list)
            }
        )
    })
        .then((year_list) => {
            return new Promise(function (resolve) {
                async_loop(
                    year_list,
                    0,
                    function (year, index, callback) {
                        get_order_count_in_year(year, callback)
                    },
                    function () {
                        year_list = resolve(year_list)
                    }
                )
            })
        })
        .then((year_list) => {
            return new Promise(function (resolve) {
                async_loop(
                    year_list,
                    0,
                    function (year, index, callback) {
                        get_item_in_year(year, 1, callback)
                    },
                    resolve
                )
            })
        })
        .then(() => {
            status_info('完了しました．')

            order_info['count_total'] = order_info['count_done']
            notify_progress()

            worker_destroy()

            document.getElementById('start').disabled = false
        })
}

document.getElementById('start').onclick = function () {
    document.getElementById('start').disabled = true

    status_info('開始します．')

    state_init()

    worker_init().then(() => {
        get_year_list()
    })
}
