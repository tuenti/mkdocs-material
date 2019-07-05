/*
 * Copyright (c) 2016-2018 Martin Donath <martin.donath@squidfunk.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

import escape from "escape-string-regexp"
import lunr from "expose-loader?lunr!lunr"
import elasticsearch from "elasticsearch"

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Truncate a string after the given number of character
 *
 * This is not a reasonable approach, since the summaries kind of suck. It
 * would be better to create something more intelligent, highlighting the
 * search occurrences and making a better summary out of it.
 *
 * @param {string} string - String to be truncated
 * @param {number} n - Number of characters
 * @return {string} Truncated string
 */
const truncate = (string, n) => {
  let i = n
  if (string.length > i) {
    while (string[i] !== " " && --i > 0);
    return `${string.substring(0, i)}...`
  }
  return string
}

/**
 * Return the meta tag value for the given key
 *
 * @param {string} key - Meta name
 *
 * @return {string} Meta content value
 */
const translate = key => {
  const meta = document.getElementsByName(`lang:${key}`)[0]
  if (!(meta instanceof HTMLMetaElement))
    throw new ReferenceError
  return meta.content
}

/**
 * Return a deep copy of an object
 *
 * @param {string} obj - The object to be copied
 *
 * @return {string} The copied object
 */
const deepclone = obj => {
  var new_obj = {}

  Object.keys(obj).forEach(function(key) {
    new_obj[ key ] = obj[ key ];
  });
  return new_obj
}

/**
 * TO BE COMPLETED
 *
 * @param {string} a - A
 *
 * @return {string} B
 */
const getData = (resultObj, page) => {
}
/* ----------------------------------------------------------------------------
 * Class
 * ------------------------------------------------------------------------- */

export default class Result {

  /**
   * Perform search and update results on keyboard events
   *
   * @constructor
   *
   * @property {HTMLElement} el_ - Search result container
   * @property {HTMLElement} meta_ - Search meta information
   * @property {HTMLElement} list_ - Search result list
   * @property {Array<string>} lang_ - Search languages
   * @property {Object} message_ - Search result messages
   * @property {Object} index_ - Search index
   * @property {Array<Function>} stack_ - Search result stack
   * @property {string} value_ - Last input value
   * @property {string} es_host_ - ElasticSearch host
   * @property {string} es_log_level_ - ElasticSearch log level
   * @property {string} es_index_ - ElasticSearch index
   * @property {string] es_client - ElasticSearch client
   *
   * @param {(string|HTMLElement)} el - Selector or HTML element
   * @param {string} es_host - ElasticSearch host
   * @param {string} es_log_level - ElasticSearch log level
   * @param {string} es_index - ElasticSearch index
   */
  constructor(el, es_host, es_log_level, es_index) {
    const ref = (typeof el === "string")
      ? document.querySelector(el)
      : el
    if (!(ref instanceof HTMLElement))
      throw new ReferenceError
    this.el_ = ref

    /* Retrieve metadata and list element */
    const [meta, list] = Array.prototype.slice.call(this.el_.children)

    /* Set data, metadata and list elements */
    this.es_host_ = es_host
    this.es_log_level_ = es_log_level
    this.es_index_ = es_index
    this.meta_ = meta
    this.list_ = list

    /* Load messages for metadata display */
    this.message_ = {
      placeholder: this.meta_.textContent,
      none: translate("search.result.none"),
      one: translate("search.result.one"),
      other: translate("search.result.other")
    }

    /* Override tokenizer separator, if given */
    const tokenizer = translate("search.tokenizer")
    if (tokenizer.length)
      lunr.tokenizer.separator = tokenizer

    /* Load search languages */
    this.lang_ = translate("search.language").split(",")
      .filter(Boolean)
      .map(lang => lang.trim())
  }

  /**
   * Update search results
   *
   * @param {Event} ev - Input or focus event
   */
  update(ev) {

    /* Initialize index, if this has not be done yet */
    if (ev.type === "focus" && !this.initialized_) {
        this.es_client = new elasticsearch.Client({
          host: this.es_host_,
          log: this.es_log_level_
        });

        if (this.es_client) {
          this.initialized_ = true
        }

        /* Register event handler for lazy rendering */
        const container = this.el_.parentNode
        if (!(container instanceof HTMLElement))
          throw new ReferenceError
        container.addEventListener("scroll", () => {
          while (this.stack_.length && container.scrollTop +
              container.offsetHeight >= container.scrollHeight - 16)
            this.stack_.splice(0, 10).forEach(render => render())
        })

    /* Execute search on new input event */
    } else if (ev.type === "focus" || ev.type === "keyup") {
      const target = ev.target
      if (!(target instanceof HTMLInputElement))
        throw new ReferenceError

      /* Abort early, if index is not build or input hasn't changed */
      if (!this.initialized_ || target.value === this.value_)
        return

      /* Clear current list */
      while (this.list_.firstChild)
        this.list_.removeChild(this.list_.firstChild)

      /* Abort early, if search input is empty */
      this.value_ = target.value
      if (this.value_.length === 0) {
        this.meta_.textContent = this.message_.placeholder
        return
      }

      /* Perform search on index and group sections by document */
      const post_body = {
        "_source": ["title", "location"],
        "size": 50,
        "query": {
          "bool": {
            "must": [
              {
                "match": {
                  "parent_document": "full_doc"
                }
              },
              {
                "bool": {
                  "should": [
                    {
                      "match": {
                        "title": {
                          "query": this.value_,
                          "boost": 5
                        }
                      }
                    },
                    {
                      "match": {
                        "text": {
                          "query": this.value_,
                          "boost": 3
                        }
                      }
                    }
                  ]
                }
              }
            ]
          }
        },
        "highlight": {
          "fields": {
            "text": {},
            "title": {}
          },
          "pre_tags": "<em>",
          "post_tags": "</em>"
        }
      }
      var outer_this = this
      this.es_client.search({
        index: outer_this.es_index_,
        body: post_body
      }, function (error, response, status) {
        if (error) {
          console.log("search error: "+error)
        }
        else {
          var result = response.hits.hits
          var total_results = response.hits.total.value
          /* Reset stack and render results */
          outer_this.stack_ = []
          var msearch_body = []
          result.forEach((hit) => {
            // Enrich sections
            var size = 0
            if (hit.highlight.title) {
              size += hit.highlight.title.length
            }
            if (hit.highlight.text) {
              size += hit.highlight.text.length
            }
            const section_post_body = { // Didn't want to repeat myself, but life is hard sometimes
              "_source": ["title", "location", "text"],
              "size": size,
              "query": {
                "bool": {
                  "must": [
                    {
                      "match": {
                        "parent_document": "section"
                      }
                    },
                    {
                      "parent_id": {
                        "type": "section",
                        "id": hit._id
                      }
                    },
                    {
                      "bool": {
                        "should": [
                          {
                            "match": {
                              "title": {
                                "query": outer_this.value_,
                                "boost": 5
                              }
                            }
                          },
                          {
                            "match": {
                              "text": {
                                "query": outer_this.value_,
                                "boost": 3
                              }
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
              },
              "highlight": {
                "fields": {
                  "text": {},
                  "title": {}
                },
                "pre_tags": "<em>",
                "post_tags": "</em>"
              }
            }
            msearch_body.push({"index": outer_this.es_index_})
            msearch_body.push(section_post_body)
          })
          if (msearch_body.length > 0) {
            outer_this.es_client.msearch({
              body: msearch_body
            }, function (error, sections_response, status) {
              if (error) {
                console.log("msearch error: "+error)
              }
              else {
                console.log("MSearch took", sections_response.took)
                var section_result = sections_response.responses
                section_result.forEach((section_hit, index) => {
                  const hit = result[index]
                  const articleLocation = "/" + hit._source.location // FIXME add config base url
                  var title_str = hit._source.title
                  if (hit.highlight.title) {
                    title_str = hit.highlight.title[0]
                  }

                  // Try to find the best title teaser
                  var teaserHighlight = ""
                  section_hit.hits.hits.forEach((section_obj) => {
                    if (section_obj._source.title == result[index]._source.title) {
                      if (section_obj.highlight.text) {
                        teaserHighlight = section_obj.highlight.text[0]
                      }
                    }
                  })

                  /* Render article */
                  const article = (
                    <li class="md-search-result__item">
                      <a href={articleLocation} title={hit._source.title}
                        class="md-search-result__link" tabindex="-1">
                        <article class="md-search-result__article md-search-result__article--document">
                          <h1 class="md-search-result__title">
                            {{ __html: title_str }}
                          </h1>
                          { teaserHighlight ?
                            <p class="md-search-result__teaser">
                              {{ __html: teaserHighlight }}
                            </p> : {}}
                        </article>
                      </a>
                    </li>
                  )

                  /* Render sections for article */
                  // const sections = []
                  const sections = section_hit.hits.hits.map(hit => {
                    return () => {
                      const sectionLocation = "/" + hit._source.location // FIXME add config base url
                      var title_str = hit._source.title
                      if (hit.highlight.title) {
                        title_str = hit.highlight.title[0]
                      }
                      var text_str = hit._source.text
                      if (hit.highlight.text) {
                        text_str = hit.highlight.text[0]
                      }
                      article.appendChild(
                        <a href={sectionLocation} title={hit._source.title}
                          class="md-search-result__link" data-md-rel="anchor"
                          tabindex="-1">
                          <article class="md-search-result__article">
                            <h1 class="md-search-result__title">
                              {{ __html: title_str }}
                            </h1>
                              <p class="md-search-result__teaser">
                                {{ __html: truncate( text_str , 200) }}
                              </p>
                          </article>
                        </a>
                      )
                    }
                  })
                  /* Push articles and section renderers onto stack */
                  outer_this.stack_.push(() => outer_this.list_.appendChild(article), ...sections)
                })
                /* Gradually add results as long as the height of the container grows */
                const container = outer_this.el_.parentNode
                if (!(container instanceof HTMLElement))
                  throw new ReferenceError
                while (outer_this.stack_.length &&
                    container.offsetHeight >= container.scrollHeight - 16)
                  (outer_this.stack_.shift())()

                /* Bind click handlers for anchors */
                const anchors = outer_this.list_.querySelectorAll("[data-md-rel=anchor]")
                Array.prototype.forEach.call(anchors, anchor => {
                  ["click", "keydown"].forEach(action => {
                    anchor.addEventListener(action, ev2 => {
                      if (action === "keydown" && ev2.keyCode !== 13)
                        return

                      /* Close search */
                      const toggle = document.querySelector("[data-md-toggle=search]")
                      if (!(toggle instanceof HTMLInputElement))
                        throw new ReferenceError
                      if (toggle.checked) {
                        toggle.checked = false
                        toggle.dispatchEvent(new CustomEvent("change"))
                      }

                      /* Hack: prevent default, as the navigation needs to be delayed due
                        to the search body lock on mobile */
                      ev2.preventDefault()
                      setTimeout(() => {
                        document.location.href = anchor.href
                      }, 100)
                    })
                  })
                })

              }
            })
          }

          /* Update search metadata */
          switch (total_results) {
            case 0:
              outer_this.meta_.textContent = outer_this.message_.none
              break
            case 1:
              outer_this.meta_.textContent = outer_this.message_.one
              break
            default:
              outer_this.meta_.textContent =
                outer_this.message_.other.replace("#", total_results)
          }

        }
      });
    }
  }
}
