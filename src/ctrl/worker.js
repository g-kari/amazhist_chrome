// content_scripts との通信関係

log.setLevel('trace')

const RETRY_COUNT = 2

var tab_id_map
var event_map

function worker_init() {
    tab_id_map = {
        worker: null
    }

    event_map = {
        onload: null
    }

    return new Promise(function (resolve) {
        tab_open('worker', 'https://www.amazon.co.jp/', false, function () {
            chrome.runtime.sendMessage(
                {
                    to: 'background',
                    tabid: tab_id_map['worker']
                },
                function (response) {
                    chrome.tabs.onUpdated.addListener(function (tab_id, change_info, tab) {
                        if (tab_id_map['worker'] == null || tab_id != tab_id_map['worker']) {
                            return
                        }
                        if (tab.status === 'complete') {
                            if (event_map['onload'] != null) {
                                event_map['onload']()
                                event_map['onload'] = null
                            }
                        }
                    })
                    log.info('Window intialization is done')
                    resolve()
                }
            )
        })
    })
}

function worker_destroy() {
    tab_close('worker')
}

function tab_open_impl(type, url, active, callback) {
    chrome.tabs.create({ url: url, active: active }, function (tab) {
        tab_id_map[type] = tab.id
        chrome.tabs.update(tab_id_map[type], { autoDiscardable: false }, function () {
            callback()
        })
    })
}

function tab_open(type, url, active, callback) {
    if (tab_id_map[type] == null) {
        tab_open_impl(type, url, active, callback)
    } else {
        chrome.tabs.get(tab_id_map[type], function (tab) {
            if (typeof tab === 'undefined') {
                tab_open_impl(type, url, active, callback)
            } else {
                callback()
            }
        })
    }
}

function tab_close(type) {
    if (tab_id_map[type] == null) {
        return
    }
    chrome.tabs.remove(tab_id_map[type])
    tab_id_map[type] = null
}

function hist_page_url(year, page) {
    return (
        'https://www.amazon.co.jp/your-orders/orders?timeFilter=year-' +
        year +
        '&startIndex=' +
        (page - 1) * 10
    )
}

function sleep(sec) {
    return new Promise((resolve) => setTimeout(resolve, sec * 1000))
}

async function cmd_request_parse(cmd, url, message, post_exec, fail_count = 0) {
    if (fail_count != 0) {
        await sleep(2)
    }

    if (message !== '') {
        status_info(message, false)
    }

    return new Promise(function (resolve, reject) {
        event_map['onload'] = function () {
            chrome.tabs.sendMessage(tab_id_map['worker'], cmd, function (response) {
                event_map['onload'] = null
                if (typeof response === 'string' || typeof response === 'undefined') {
                    status_error(response)
                    reject()
                } else {
                    resolve(post_exec(response))
                }
            })
        }

        chrome.tabs.update(tab_id_map['worker'], { url: url })
    }).catch(function (error) {
        fail_count += 1

        if (fail_count < RETRY_COUNT) {
            status_info('リトライします．')
            return cmd_request_parse(cmd, url, message, post_exec, fail_count)
        } else {
            status_info('エラーが連続したので諦めます．(URL: ' + url + ')')
            post_exec({ list: [] })
        }
    })
}

async function cmd_handle_parse(cmd, send_response) {
    cmd['to'] = 'content'

    if (cmd['target'] === 'year_list') {
        message = '注文がある年を解析します．\n'
        url = hist_page_url(2020, 1) // ダミー
        post_exec = function (response) {
            status_info('　　' + response['list'].length + '年分の注文リストが見つかりました．')
            send_response(response)
        }
    } else if (cmd['target'] === 'order_count') {
        message = cmd['year'] + '年の注文件数を解析します．\n'
        url = hist_page_url(cmd['year'], 1)
        post_exec = function (response) {
            status_info('　　' + response['count'] + '件の注文が見つかりました．')
            response['year'] = cmd['year']
            send_response(response)
        }
    } else if (cmd['target'] === 'list') {
        message = cmd['year'] + '年の注文リストを解析します．(p.' + cmd['page'] + '/' + cmd['page_total'] + ')\n'
        url = hist_page_url(cmd['year'], cmd['page'])
        post_exec = function (response) {
            response['year'] = cmd['year']
            send_response(response)
        }
    } else if (cmd['target'] === 'detail') {
        message = cmd['index'] + 1 + '件目． '
        if ((cmd['mode'] & 0x01) != 0) {
            message = '　　' + message
        }
        if ((cmd['mode'] & 0x10) != 0) {
            message += '\n'
        }
        url = cmd['url']
        post_exec = function (response) {
            response['date'] = cmd['date']
            send_response(response)
        }
        await sleep(1)
    } else {
        status_error('未知のコマンドです．\n')
        return
    }

    cmd_request_parse(cmd, url, message, post_exec)
}

// NOTE: このファイルで定義している関数を Background script に配置して，
// chrome.runtime.sendMessage でやりとりしていた時の名残．
function cmd_handle(cmd, send_response) {
    if (cmd['to'] !== 'background') {
        return false
    }

    if (cmd['type'] === 'parse') {
        cmd_handle_parse(cmd, send_response)
    } else {
        log.warn({
            msg: 'Unknown cmd type',
            cmd: cmd
        })
        send_response('Unknown cmd type')
    }
}
