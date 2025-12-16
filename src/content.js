document.xpath = function (expression) {
    ret = document.evaluate(expression, document)

    switch (ret.resultType) {
        case 1:
            return ret.numberValue
        case 2:
            return ret.stringValue
        case 3:
            return ret.booleanValue
        case 4:
        case 5:
            var v = []
            while ((e = ret.iterateNext())) {
                v.push(e)
            }
            return v
        default:
            return ret
    }
}

function print_stacktrace(e) {
    log.error(e.message)
    log.error(e.stack)
}

function year_list_page_parse() {
    year_list = []

    // Try modern selector first (#time-filter), then fall back to legacy (#orderFilter)
    let year_selector = document.querySelector('#time-filter')
    if (!year_selector) {
        year_selector = document.querySelector('#orderFilter')
    }

    if (!year_selector) {
        log.error('Year filter selector not found')
        return { list: [] }
    }

    const options = year_selector.querySelectorAll('option')

    options.forEach(option => {
        const year_text = option.innerText.trim()
        // Match patterns like "2024年", "2024", or extract year from text
        const year_match = year_text.match(/(\d{4})/)
        if (year_match) {
            const year = parseInt(year_match[1])
            if (year >= 1900 && year <= 2100) {
                year_list.push(year)
            }
        }
    })

    return {
        list: year_list
    }
}

function order_count_page_parse() {
    // Try multiple selectors for order count
    let order_count_element = document.querySelector('.num-orders')

    if (!order_count_element) {
        // Fallback to xpath
        const xpath_result = document.xpath('//label[@for="orderFilter"]//span[contains(@class, "num-orders")]')
        if (xpath_result && xpath_result.length > 0) {
            order_count_element = xpath_result[0]
        }
    }

    if (!order_count_element) {
        // Try alternative selector for time-filter
        const xpath_result2 = document.xpath('//label[@for="time-filter"]//span[contains(@class, "num-orders")]')
        if (xpath_result2 && xpath_result2.length > 0) {
            order_count_element = xpath_result2[0]
        }
    }

    if (!order_count_element) {
        log.error('Order count element not found')
        return { count: 0 }
    }

    const order_count_text = order_count_element.innerText.trim()
    const order_count = parseInt(order_count_text.replace('件', '').replace(',', ''))

    return {
        count: order_count
    }
}

function order_list_page_parse() {
    // Try modern selector first, then fall back to legacy
    let order_cards = document.querySelectorAll('.js-order-card')

    if (order_cards.length === 0) {
        // Fallback to legacy selector
        order_cards = document.querySelectorAll('div.order')
    }

    if (order_cards.length === 0) {
        // Try XPath as last resort
        order_cards = document.xpath('//div[contains(@class, " order ")]')
    }

    log.info({ order_count: order_cards.length })

    detail_page_list = []

    order_cards.forEach((order_card, index) => {
        try {
            // Try to find date element with multiple selectors
            let date_element = order_card.querySelector('.order-info .value')
            if (!date_element) {
                date_element = order_card.querySelector('.a-col-left .a-span3 .a-row:last-child .a-color-secondary')
            }
            if (!date_element) {
                // Try xpath within this order card
                const xpath_date = document.evaluate(
                    './/div[contains(@class, "order-info")]//span[contains(@class, "value")]',
                    order_card,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                )
                if (xpath_date.singleNodeValue) {
                    date_element = xpath_date.singleNodeValue
                }
            }

            // Try to find order detail link with multiple selectors
            let detail_link = order_card.querySelector('a[href*="order-details"]')
            if (!detail_link) {
                detail_link = Array.from(order_card.querySelectorAll('a')).find(a =>
                    a.textContent.includes('注文内容を表示') ||
                    a.textContent.includes('View order details') ||
                    a.href.includes('order-details')
                )
            }
            if (!detail_link) {
                // Try xpath within this order card
                const xpath_link = document.evaluate(
                    './/a[contains(text(), "注文内容を表示") or contains(@href, "order-details")]',
                    order_card,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                )
                if (xpath_link.singleNodeValue) {
                    detail_link = xpath_link.singleNodeValue
                }
            }

            if (date_element && detail_link) {
                const date = date_element.innerText.trim()
                detail_page_list.push({
                    date: date.replace('年', '/').replace('月', '/').replace('日', ''), // 雑だけど動く
                    url: detail_link.href
                })
            } else {
                log.warn(`Order ${index + 1}: Could not find date or detail link`)
            }
        } catch (e) {
            log.error(`Error parsing order ${index + 1}:`, e.message)
        }
    })

    // Check if this is the last page
    const is_last = !document.querySelector('ul.a-pagination li.a-last a') &&
                    document.xpath('count(//ul[contains(@class, "a-pagination")]/li[contains(@class, "a-last")]/a)') == 0

    return {
        list: detail_page_list,
        is_last: is_last
    }
}

function order_item_page_parse(parent_xpath) {
    const link = document.xpath(
        parent_xpath + '//div[contains(@class, "a-col-right")]//a[contains(@class, "a-link-normal")]'
    )[0]

    const name = link.innerText
    const url = link.href
    const asin = url.match(new RegExp('/gp/product/([^/]+)/'))[1]

    const price_str = document.xpath(
        parent_xpath + '//div[contains(@class, "a-row")]/span[contains(@class, "a-color-price")]'
    )[0].innerText
    var price = parseInt(price_str.replace(',', '').match(new RegExp('[\\d,]+'))[0], 10)

    const seller_str = document.xpath(
        parent_xpath +
            '//div[contains(@class, "a-row")]/span[contains(@class, "a-size-small") and contains(text(), "販売:")]'
    )[0].innerText
    const seller = seller_str.match(new RegExp('販売:\\s+(.+)$'))[1]

    const img_url = document.xpath(parent_xpath + '//div[contains(@class, "item-view-left-col-inner")]//img')[0]
        .currentSrc

    const quantity_count = document.xpath(
        parent_xpath + '//div[contains(@class, "item-view-left-col-inner")]//span[contains(@class, "item-view-qty")]'
    )[0]

    var quantity = 1
    if (quantity_count != undefined) {
        quantity = parseInt(quantity_count.innerText, 10)
        price *= quantity
    }

    return {
        name: name,
        url: url,
        asin: asin,
        quantity: quantity,
        price: price,
        seller: seller,
        img_url
    }
}

function order_detail_page_parse_normal() {
    log.info('通常注文')

    const item_total_count = document.xpath(
        'count(//div[contains(@class, "a-box shipment")]//div[contains(@class, "a-fixed-left-grid a-spacing-")])'
    )
    var item_list = []

    const ship_count = document.xpath('count(//div[contains(@class, "a-box shipment")])')
    for (var i = 0; i < ship_count; i++) {
        const item_count = document.xpath(
            'count(//div[contains(@class, "a-box shipment")][' +
                (i + 1) +
                ']' +
                '//div[contains(@class, "a-fixed-left-grid a-spacing-")])'
        )
        for (var j = 0; j < item_count; j++) {
            const parent_xpath =
                '//div[contains(@class, "a-box shipment")][' +
                (i + 1) +
                ']' +
                '//div[contains(@class, "a-fixed-left-grid a-spacing-")][' +
                (j + 1) +
                ']'
            item = order_item_page_parse(parent_xpath)
            item_list.push(item)
        }
    }

    return {
        list: item_list
    }
}

function order_detail_page_parse_digital() {
    log.info('デジタル注文')

    const item_total_count = document.xpath(
        'count(//div[contains(@class, "a-box")]//div[contains(@class, "a-fixed-left-grid a-spacing-")])'
    )

    var item_list = []

    const item_count = document.xpath(
        'count(//div[contains(@class, "a-box")]//div[contains(@class, "a-fixed-left-grid a-spacing-")])'
    )
    for (var i = 0; i < item_count; i++) {
        const parent_xpath =
            '//div[contains(@class, "a-box")]' +
            '//div[contains(@class, "a-fixed-left-grid a-spacing-")][' +
            (i + 1) +
            ']'
        item = order_item_page_parse(parent_xpath)
        item_list.push(item)
    }

    log.info({ item_list: item_list })

    return {
        list: item_list
    }
}

function order_detail_page_parse() {
    try {
        if (document.xpath('count(//div[contains(@class, "a-box shipment")])') != 0) {
            return order_detail_page_parse_normal()
        } else {
            return order_detail_page_parse_digital()
        }
    } catch (e) {
        print_stacktrace(e)

        var amazon_msg = ''
        try {
            amazon_msg = document.xpath('//h4[contains(@class, "a-alert-heading")]')[0].innerText.trim()
        } catch (e) {}
        if (amazon_msg != '') {
            return '[amazon]' + amazon_msg
        } else {
            return e.message
        }
    }
}

function cmd_handler(cmd, sender, send_response) {
    if (cmd['to'] !== 'content') {
        return false
    }

    if (cmd['type'] === 'parse') {
        if (cmd['target'] === 'year_list') {
            send_response(year_list_page_parse())
        } else if (cmd['target'] === 'order_count') {
            send_response(order_count_page_parse())
        } else if (cmd['target'] === 'list') {
            send_response(order_list_page_parse())
        } else if (cmd['target'] === 'detail') {
            send_response(order_detail_page_parse())
        } else {
            log.error({
                msg: 'Unknown cmd target',
                cmd: cmd
            })
            send_response('ERROR: Unknown cmd target')
        }
    } else {
        log.error({
            msg: 'Unknown cmd type',
            cmd: cmd
        })
        send_response('ERROR: Unknown cmd type')
    }
}

chrome.runtime.onMessage.addListener(cmd_handler)
